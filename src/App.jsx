import { useEffect, useMemo, useRef, useState } from 'react';

const CYCLING_POWER_SERVICE = 0x1818;
const CYCLING_POWER_MEASUREMENT = 0x2a63;
const CYCLING_POWER_FEATURE = 0x2a65;
const CYCLING_POWER_CONTROL_POINT = 0x2a66;
const SENSOR_LOCATION = 0x2a5d;
const START_OFFSET_COMPENSATION = 0x0c;
const CONTROL_POINT_RESPONSE = 0x20;
const RESPONSE_SUCCESS = 0x01;
const PEDAL_POWER_BALANCE_PRESENT = 1 << 0;
const ACCUMULATED_TORQUE_PRESENT = 1 << 2;
const WHEEL_REVOLUTION_DATA_PRESENT = 1 << 4;
const CRANK_REVOLUTION_DATA_PRESENT = 1 << 5;
const EXTREME_FORCE_MAGNITUDES_PRESENT = 1 << 6;
const EXTREME_TORQUE_MAGNITUDES_PRESENT = 1 << 7;
const EXTREME_ANGLES_PRESENT = 1 << 8;
const TOP_DEAD_SPOT_ANGLE_PRESENT = 1 << 9;
const BOTTOM_DEAD_SPOT_ANGLE_PRESENT = 1 << 10;
const ACCUMULATED_ENERGY_PRESENT = 1 << 11;

const initialMetrics = {
  watts: 0,
  cadence: 0,
  speedKmh: null,
  distanceKm: 0,
  movingSeconds: 0,
  balance: null,
  balanceReference: 'unknown',
  flagsHex: '0x0000',
  avgWatts: 0,
  samples: 0,
  zone: 'Bereit',
  zoneColor: 'from-cyan-400 to-emerald-300',
};

function readCyclingPowerMeasurement(value) {
  const flags = value.getUint16(0, true);
  const watts = value.getInt16(2, true);
  const rawHex = Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(' ');
  let offset = 4;
  let crank = null;
  let balance = null;
  let balanceReference = 'unknown';

  if (flags & PEDAL_POWER_BALANCE_PRESENT && value.byteLength >= offset + 1) {
    balance = value.getUint8(offset) / 2;
    balanceReference = flags & (1 << 1) ? 'right' : 'left';
    offset += 1;
  }
  if (flags & ACCUMULATED_TORQUE_PRESENT) offset += 2;
  if (flags & WHEEL_REVOLUTION_DATA_PRESENT) offset += 6;

  if (flags & CRANK_REVOLUTION_DATA_PRESENT && value.byteLength >= offset + 4) {
    crank = {
      revolutions: value.getUint16(offset, true),
      eventTime: value.getUint16(offset + 2, true), // 1/1024 second units
    };
    offset += 4;
  }

  if (flags & EXTREME_FORCE_MAGNITUDES_PRESENT) offset += 4;
  if (flags & EXTREME_TORQUE_MAGNITUDES_PRESENT) offset += 4;
  if (flags & EXTREME_ANGLES_PRESENT) offset += 3;
  if (flags & TOP_DEAD_SPOT_ANGLE_PRESENT) offset += 2;
  if (flags & BOTTOM_DEAD_SPOT_ANGLE_PRESENT) offset += 2;
  if (flags & ACCUMULATED_ENERGY_PRESENT) offset += 2;

  return { flags, watts, crank, balance, balanceReference, rawHex, byteLength: value.byteLength };
}

function deltaWithRollover(current, previous, rollover) {
  return current >= previous ? current - previous : current + rollover - previous;
}

function powerZone(watts) {
  if (watts >= 850) {
    return { zone: 'Sprint', zoneColor: 'from-rose-400 to-orange-300', width: '100%' };
  }
  if (watts >= 420) {
    return { zone: 'VO2 Max', zoneColor: 'from-fuchsia-400 to-rose-300', width: '82%' };
  }
  if (watts >= 300) {
    return { zone: 'Schwelle', zoneColor: 'from-amber-300 to-lime-300', width: '64%' };
  }
  if (watts >= 180) {
    return { zone: 'Tempo', zoneColor: 'from-cyan-300 to-blue-300', width: '45%' };
  }
  if (watts > 0) {
    return { zone: 'Ausdauer', zoneColor: 'from-emerald-400 to-cyan-300', width: '28%' };
  }
  return { zone: 'Bereit', zoneColor: 'from-slate-500 to-slate-300', width: '8%' };
}

function controlPointResponseText(value) {
  switch (value) {
    case RESPONSE_SUCCESS:
      return 'Kalibrierung abgeschlossen';
    case 0x02:
      return 'Kalibrierung nicht unterstuetzt';
    case 0x03:
      return 'Ungueltige Kalibrierparameter';
    case 0x04:
      return 'Kalibrierung fehlgeschlagen';
    default:
      return `Unbekannte Antwort 0x${value.toString(16).padStart(2, '0')}`;
  }
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function distanceInKm(a, b) {
  const radiusKm = 6371;
  const toRad = (value) => (value * Math.PI) / 180;
  const latDelta = toRad(b.latitude - a.latitude);
  const lonDelta = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const haversine =
    Math.sin(latDelta / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2;
  return 2 * radiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function describeMeasurementFlags(flags) {
  return [
    ['Pedal Balance', Boolean(flags & PEDAL_POWER_BALANCE_PRESENT)],
    ['Torque', Boolean(flags & ACCUMULATED_TORQUE_PRESENT)],
    ['Wheel Rev', Boolean(flags & WHEEL_REVOLUTION_DATA_PRESENT)],
    ['Crank Rev', Boolean(flags & CRANK_REVOLUTION_DATA_PRESENT)],
    ['Force', Boolean(flags & EXTREME_FORCE_MAGNITUDES_PRESENT)],
    ['Torque Peaks', Boolean(flags & EXTREME_TORQUE_MAGNITUDES_PRESENT)],
    ['Angles', Boolean(flags & EXTREME_ANGLES_PRESENT)],
    ['TDC', Boolean(flags & TOP_DEAD_SPOT_ANGLE_PRESENT)],
    ['BDC', Boolean(flags & BOTTOM_DEAD_SPOT_ANGLE_PRESENT)],
    ['Energy', Boolean(flags & ACCUMULATED_ENERGY_PRESENT)],
  ].filter(([, active]) => active);
}

function shortUuid(uuid) {
  const match = uuid.match(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i);
  return match ? `0x${match[1].toUpperCase()}` : uuid;
}

export default function App() {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [connectionState, setConnectionState] = useState('idle');
  const [deviceName, setDeviceName] = useState('');
  const [error, setError] = useState('');
  const [lastPacketAt, setLastPacketAt] = useState(null);
  const [autoConnectAvailable, setAutoConnectAvailable] = useState(false);
  const [calibrationState, setCalibrationState] = useState('unknown');
  const [calibrationMessage, setCalibrationMessage] = useState('Noch nicht kalibriert');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [gpsState, setGpsState] = useState('off');
  const [gpsMessage, setGpsMessage] = useState('GPS aus');
  const [diagnostics, setDiagnostics] = useState({
    rawHex: '',
    byteLength: 0,
    fields: [],
    characteristics: [],
    featureHex: 'nicht gelesen',
    sensorLocation: 'nicht gelesen',
  });

  const deviceRef = useRef(null);
  const characteristicRef = useRef(null);
  const controlPointRef = useRef(null);
  const calibrationResolverRef = useRef(null);
  const crankRef = useRef(null);
  const lastCadenceUpdateRef = useRef(0);
  const reconnectingRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const gpsWatchRef = useRef(null);
  const lastPositionRef = useRef(null);
  const lastMovementAtRef = useRef(0);

  const connected = connectionState === 'connected';
  const reconnectVisible = connectionState === 'lost' || connectionState === 'error';
  const stale = connected && lastPacketAt && Date.now() - lastPacketAt > 3500;

  const cadenceProgress = Math.min(100, Math.max(0, (metrics.cadence / 130) * 100));
  const cadenceRing = `conic-gradient(rgb(34 211 238) ${cadenceProgress * 3.6}deg, rgb(30 41 59) 0deg)`;
  const zone = useMemo(() => powerZone(metrics.watts), [metrics.watts]);

  async function connect(existingDevice = deviceRef.current) {
    setError('');

    if (!window.isSecureContext) {
      setError('Web Bluetooth braucht HTTPS oder localhost.');
      setConnectionState('error');
      return;
    }

    if (!navigator.bluetooth) {
      setError('Dieser Browser stellt keine Web Bluetooth API bereit. Bitte Chrome, Chromium oder Edge verwenden.');
      setConnectionState('error');
      return;
    }

    setConnectionState(existingDevice ? 'reconnecting' : 'scanning');

    try {
      const device =
        existingDevice ||
        (await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [CYCLING_POWER_SERVICE],
        }));

      deviceRef.current = device;
      setDeviceName(device.name || 'Cycling Power Pedal');
      localStorage.setItem('xpedo-auto-connect', '1');
      device.addEventListener('gattserverdisconnected', handleDisconnected);

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(CYCLING_POWER_SERVICE);
      const characteristic = await service.getCharacteristic(CYCLING_POWER_MEASUREMENT);
      const characteristics = await service.getCharacteristics();

      setDiagnostics((current) => ({
        ...current,
        characteristics: characteristics.map((item) => ({
          uuid: shortUuid(item.uuid),
          notify: item.properties.notify || item.properties.indicate,
          read: item.properties.read,
          write: item.properties.write || item.properties.writeWithoutResponse,
        })),
      }));

      readOptionalDiagnostics(service);

      characteristicRef.current = characteristic;
      characteristic.addEventListener('characteristicvaluechanged', handleMeasurement);
      await characteristic.startNotifications();

      try {
        const controlPoint = await service.getCharacteristic(CYCLING_POWER_CONTROL_POINT);
        controlPointRef.current = controlPoint;
        controlPoint.addEventListener('characteristicvaluechanged', handleControlPoint);
        await controlPoint.startNotifications();
        setCalibrationState('ready');
        setCalibrationMessage('Bereit fuer Nullstellen-Kalibrierung');
      } catch {
        controlPointRef.current = null;
        setCalibrationState('unsupported');
        setCalibrationMessage('Kalibrierung vom Pedal nicht freigegeben');
      }

      setConnectionState('connected');
      setLastPacketAt(Date.now());
    } catch (connectError) {
      const message =
        connectError?.name === 'NotFoundError'
          ? 'Kein Pedal ausgewählt.'
          : connectError?.message || 'Bluetooth-Verbindung fehlgeschlagen.';
      setError(message);
      setConnectionState(deviceRef.current ? 'lost' : 'error');
    }
  }

  async function calibratePedal() {
    const controlPoint = controlPointRef.current;

    if (!connected || !controlPoint) {
      setCalibrationState('unsupported');
      setCalibrationMessage('Control Point nicht verfuegbar');
      return;
    }

    setCalibrationState('running');
    setCalibrationMessage('Pedal ruhig halten...');

    try {
      const result = await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          calibrationResolverRef.current = null;
          reject(new Error('Keine Antwort vom Pedal'));
        }, 12000);

        calibrationResolverRef.current = (response) => {
          window.clearTimeout(timeout);
          resolve(response);
        };

        controlPoint.writeValueWithResponse(new Uint8Array([START_OFFSET_COMPENSATION])).catch((writeError) => {
          window.clearTimeout(timeout);
          calibrationResolverRef.current = null;
          reject(writeError);
        });
      });

      setCalibrationState(result.success ? 'success' : 'error');
      setCalibrationMessage(result.message);
    } catch (calibrationError) {
      setCalibrationState('error');
      setCalibrationMessage(calibrationError?.message || 'Kalibrierung fehlgeschlagen');
    }
  }

  async function readOptionalDiagnostics(service) {
    try {
      const feature = await service.getCharacteristic(CYCLING_POWER_FEATURE);
      const value = await feature.readValue();
      const featureValue = value.byteLength >= 4 ? `0x${value.getUint32(0, true).toString(16).padStart(8, '0')}` : 'zu kurz';
      setDiagnostics((current) => ({ ...current, featureHex: featureValue }));
    } catch {
      setDiagnostics((current) => ({ ...current, featureHex: 'nicht verfuegbar' }));
    }

    try {
      const sensorLocation = await service.getCharacteristic(SENSOR_LOCATION);
      const value = await sensorLocation.readValue();
      setDiagnostics((current) => ({ ...current, sensorLocation: String(value.getUint8(0)) }));
    } catch {
      setDiagnostics((current) => ({ ...current, sensorLocation: 'nicht verfuegbar' }));
    }
  }

  function startGps() {
    if (!navigator.geolocation) {
      setGpsState('error');
      setGpsMessage('GPS nicht verfuegbar');
      return;
    }

    setGpsState('starting');
    setGpsMessage('GPS wird aktiviert...');

    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed, accuracy } = position.coords;
        const currentPosition = { latitude, longitude, timestamp: position.timestamp };
        let speedKmh = typeof speed === 'number' && speed >= 0 ? speed * 3.6 : null;
        let distanceDelta = 0;

        if (lastPositionRef.current) {
          const secondsDelta = (position.timestamp - lastPositionRef.current.timestamp) / 1000;
          distanceDelta = distanceInKm(lastPositionRef.current, currentPosition);

          if ((speedKmh === null || speedKmh < 1) && secondsDelta > 0 && distanceDelta < 0.5) {
            speedKmh = (distanceDelta / (secondsDelta / 3600));
          }

          if (accuracy > 40 || distanceDelta > 0.5) {
            distanceDelta = 0;
          }
        }

        lastPositionRef.current = currentPosition;
        setGpsState('active');
        setGpsMessage(`GPS aktiv, Genauigkeit ${Math.round(accuracy)} m`);

        setMetrics((current) => ({
          ...current,
          speedKmh,
          distanceKm: current.distanceKm + distanceDelta,
        }));

        if ((speedKmh ?? 0) > 2) {
          lastMovementAtRef.current = Date.now();
        }
      },
      (gpsError) => {
        setGpsState('error');
        setGpsMessage(gpsError?.message || 'GPS konnte nicht gestartet werden');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 12000,
      },
    );
  }

  function stopGps() {
    if (gpsWatchRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchRef.current);
      gpsWatchRef.current = null;
    }
    lastPositionRef.current = null;
    setGpsState('off');
    setGpsMessage('GPS aus');
    setMetrics((current) => ({ ...current, speedKmh: null }));
  }

  async function reconnect() {
    if (!deviceRef.current || reconnectingRef.current) {
      await connect(null);
      return;
    }

    reconnectingRef.current = true;
    try {
      await connect(deviceRef.current);
    } finally {
      reconnectingRef.current = false;
    }
  }

  function handleDisconnected() {
    setConnectionState('lost');

    if (localStorage.getItem('xpedo-auto-connect') === '1') {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnect();
      }, 1800);
    }
  }

  function handleMeasurement(event) {
    const value = event.target.value;
    const parsed = readCyclingPowerMeasurement(value);
    const now = Date.now();
    let nextCadence = null;
    const fields = describeMeasurementFlags(parsed.flags);

    if (parsed.crank) {
      const previous = crankRef.current;
      if (previous) {
        const revDelta = deltaWithRollover(parsed.crank.revolutions, previous.revolutions, 65536);
        const timeDelta = deltaWithRollover(parsed.crank.eventTime, previous.eventTime, 65536);

        if (timeDelta > 0 && now - lastCadenceUpdateRef.current >= 900) {
          nextCadence = Math.round((revDelta / (timeDelta / 1024)) * 60);
          lastCadenceUpdateRef.current = now;
        }
      }
      crankRef.current = parsed.crank;
    }

    setLastPacketAt(now);
    setDiagnostics((current) => ({
      ...current,
      rawHex: parsed.rawHex,
      byteLength: parsed.byteLength,
      fields: fields.map(([label]) => label),
    }));
    if (parsed.watts > 0 || (nextCadence ?? metrics.cadence) > 0) {
      lastMovementAtRef.current = now;
    }

    setMetrics((current) => {
      const nextSamples = current.samples + 1;
      const nextAverage = Math.round((current.avgWatts * current.samples + parsed.watts) / nextSamples);
      const nextZone = powerZone(parsed.watts);

      return {
        ...current,
        watts: parsed.watts,
        cadence: nextCadence ?? current.cadence,
        balance: parsed.balance ?? current.balance,
        balanceReference: parsed.balance ? parsed.balanceReference : current.balanceReference,
        flagsHex: `0x${parsed.flags.toString(16).padStart(4, '0')}`,
        avgWatts: nextAverage,
        samples: nextSamples,
        zone: nextZone.zone,
        zoneColor: nextZone.zoneColor,
      };
    });
  }

  function handleControlPoint(event) {
    const value = event.target.value;
    if (value.byteLength < 3 || value.getUint8(0) !== CONTROL_POINT_RESPONSE) return;

    const requestOpCode = value.getUint8(1);
    if (requestOpCode !== START_OFFSET_COMPENSATION) return;

    const responseValue = value.getUint8(2);
    let message = controlPointResponseText(responseValue);

    if (responseValue === RESPONSE_SUCCESS && value.byteLength >= 5) {
      const offsetCompensation = value.getInt16(3, true);
      message = `Offset ${offsetCompensation}`;
    }

    calibrationResolverRef.current?.({
      success: responseValue === RESPONSE_SUCCESS,
      message,
    });
    calibrationResolverRef.current = null;
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!lastPacketAt || Date.now() - lastPacketAt <= 4500) return;
      setMetrics((current) => ({ ...current, cadence: 0, watts: 0 }));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [lastPacketAt]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (Date.now() - lastMovementAtRef.current > 2500) return;
      setMetrics((current) => ({ ...current, movingSeconds: current.movingSeconds + 1 }));
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function connectKnownDevice() {
      if (!navigator.bluetooth?.getDevices || localStorage.getItem('xpedo-auto-connect') !== '1') return;

      try {
        const devices = await navigator.bluetooth.getDevices();
        const knownPedal = devices.find((device) => {
          const name = device.name?.toLowerCase() || '';
          return name.includes('xpedo') || name.includes('omni') || name.includes('power');
        });

        if (!cancelled && knownPedal) {
          setAutoConnectAvailable(true);
          await connect(knownPedal);
        }
      } catch {
        setAutoConnectAvailable(false);
      }
    }

    connectKnownDevice();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      window.clearTimeout(reconnectTimerRef.current);
      const characteristic = characteristicRef.current;
      if (characteristic) {
        characteristic.removeEventListener('characteristicvaluechanged', handleMeasurement);
        characteristic.stopNotifications?.().catch(() => {});
      }
      const controlPoint = controlPointRef.current;
      if (controlPoint) {
        controlPoint.removeEventListener('characteristicvaluechanged', handleControlPoint);
        controlPoint.stopNotifications?.().catch(() => {});
      }
      if (gpsWatchRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
      }
      deviceRef.current?.removeEventListener('gattserverdisconnected', handleDisconnected);
      deviceRef.current?.gatt?.disconnect();
    };
  }, []);

  return (
    <main className="min-h-screen bg-zinc-950 p-3 text-zinc-100 antialiased sm:p-6">
      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] w-full max-w-[460px] flex-col overflow-hidden rounded-[2rem] border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black">
        <div className="relative border-b border-black bg-black px-4 py-3 font-mono text-sm font-bold text-zinc-100">
          <div className="flex items-center justify-between">
            <span>FAHRT</span>
            <div className="flex items-center gap-3">
              <span className={connected ? 'text-lime-300' : 'text-zinc-500'}>BLE</span>
              <span className={gpsState === 'active' ? 'text-lime-300' : 'text-zinc-500'}>GPS</span>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="grid h-8 w-8 place-items-center rounded border border-zinc-700 bg-zinc-900"
                aria-label="Menue"
              >
                <span className="space-y-1">
                  <span className="block h-0.5 w-4 bg-zinc-100" />
                  <span className="block h-0.5 w-4 bg-zinc-100" />
                  <span className="block h-0.5 w-4 bg-zinc-100" />
                </span>
              </button>
            </div>
          </div>

          {menuOpen && (
            <div className="absolute right-3 top-14 z-30 w-72 rounded border border-black bg-[#c2c6b8] p-2 font-mono text-black shadow-xl">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  connect(null);
                }}
                disabled={connectionState === 'scanning' || connectionState === 'reconnecting'}
                className="flex w-full justify-between border-b border-black/40 px-2 py-3 text-left text-sm font-black disabled:opacity-50"
              >
                <span>{connected ? 'PEDAL NEU VERBINDEN' : 'PEDALE VERBINDEN'}</span>
                <span>{connectionState === 'scanning' ? '...' : 'BLE'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  calibratePedal();
                }}
                disabled={!connected || calibrationState === 'running' || calibrationState === 'unsupported'}
                className="flex w-full justify-between border-b border-black/40 px-2 py-3 text-left text-sm font-black disabled:opacity-50"
              >
                <span>{calibrationState === 'running' ? 'KALIBRIERT...' : 'KALIBRIEREN'}</span>
                <span>0x2A66</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  if (gpsState === 'active' || gpsState === 'starting') stopGps();
                  else startGps();
                }}
                className="flex w-full justify-between border-b border-black/40 px-2 py-3 text-left text-sm font-black"
              >
                <span>{gpsState === 'active' || gpsState === 'starting' ? 'GPS STOPPEN' : 'GPS AKTIVIEREN'}</span>
                <span>{gpsState === 'active' ? 'ON' : gpsState === 'starting' ? '...' : 'OFF'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDiagnostics((visible) => !visible);
                  setMenuOpen(false);
                }}
                className="flex w-full justify-between border-b border-black/40 px-2 py-3 text-left text-sm font-black"
              >
                <span>DIAGNOSE</span>
                <span>{showDiagnostics ? 'ON' : 'OFF'}</span>
              </button>
              <div className="px-2 py-3 text-xs font-bold leading-5">
                <p>{connected ? deviceName || 'VERBUNDEN' : 'NICHT VERBUNDEN'}</p>
                <p>{calibrationMessage}</p>
                <p>{gpsMessage}</p>
              </div>
            </div>
          )}
        </div>

        <section className={`relative flex-1 bg-[#b9bdaf] text-black transition ${reconnectVisible || stale ? 'opacity-50' : ''}`}>
          <div className="grid grid-cols-2 border-b border-black/70">
            <div className="col-span-2 border-b border-black/70 p-4">
              <div className="mb-1 font-mono text-sm font-black">WATT</div>
              <div className="flex items-end justify-center gap-2 font-mono tracking-normal">
                <span className="text-[7.8rem] font-black leading-none sm:text-[8.8rem]">{Math.max(0, metrics.watts)}</span>
                <span className="pb-4 text-3xl font-black">W</span>
              </div>
            </div>

            <div className="border-r border-black/70 p-3">
              <div className="font-mono text-sm font-black">KADENZ</div>
              <div className="mt-2 flex items-end justify-center gap-1 font-mono">
                <span className="text-6xl font-black leading-none">{metrics.cadence}</span>
                <span className="pb-1 text-sm font-black">RPM</span>
              </div>
            </div>
            <div className="p-3">
              <div className="font-mono text-sm font-black">GESCHW.</div>
              <div className="mt-2 flex items-end justify-center gap-1 font-mono">
                <span className="text-6xl font-black leading-none">{metrics.speedKmh === null ? '--' : metrics.speedKmh.toFixed(1)}</span>
                <span className="pb-1 text-xs font-black">KM/H</span>
              </div>
            </div>

            <div className="border-t border-r border-black/70 p-3">
              <div className="font-mono text-sm font-black">ZEIT</div>
              <div className="mt-3 text-center font-mono text-3xl font-black leading-none">{formatDuration(metrics.movingSeconds)}</div>
            </div>
            <div className="border-t border-black/70 p-3">
              <div className="font-mono text-sm font-black">DISTANZ</div>
              <div className="mt-3 flex items-end justify-center gap-1 font-mono">
                <span className="text-4xl font-black leading-none">{metrics.distanceKm.toFixed(2)}</span>
                <span className="pb-1 text-xs font-black">KM</span>
              </div>
            </div>

            <div className="border-t border-r border-black/70 p-3">
              <div className="font-mono text-sm font-black">Ø WATT</div>
              <div className="mt-2 flex items-end justify-center gap-1 font-mono">
                <span className="text-5xl font-black leading-none">{metrics.avgWatts}</span>
                <span className="pb-1 text-sm font-black">W</span>
              </div>
            </div>
            <div className="border-t border-black/70 p-3">
              <div className="font-mono text-sm font-black">BALANCE</div>
              <div className="mt-2 text-center font-mono text-5xl font-black leading-none">
                {metrics.balance === null
                  ? '--'
                  : metrics.balanceReference === 'right'
                    ? `${Math.round(100 - metrics.balance)}/${Math.round(metrics.balance)}`
                    : `${Math.round(metrics.balance)}/${Math.round(100 - metrics.balance)}`}
              </div>
            </div>

            <div className="col-span-2 border-t border-black/70 p-3">
              <div className="mb-2 flex justify-between font-mono text-sm font-black">
                <span>ZONE</span>
                <span>{zone.zone.toUpperCase()}</span>
              </div>
              <div className="grid h-4 grid-cols-[repeat(16,minmax(0,1fr))] gap-px border border-black bg-black p-px">
                {Array.from({ length: 16 }).map((_, index) => {
                  const active = index < Math.max(1, Math.round((parseFloat(zone.width) / 100) * 16));
                  return <span key={index} className={active ? 'bg-black' : 'bg-[#9da294]'} />;
                })}
              </div>
            </div>
          </div>

          {showDiagnostics && (
            <div className="border-b border-black/70 p-3 font-mono text-xs font-bold leading-5">
              <div className="flex justify-between">
                <span>FLAGS {metrics.flagsHex}</span>
                <span>{diagnostics.byteLength ? `${diagnostics.byteLength} BYTES` : 'WARTET'}</span>
              </div>
              <p className="mt-2 break-all">{diagnostics.rawHex || 'NOCH KEIN MEASUREMENT'}</p>
              <p className="mt-2">FELDER: {diagnostics.fields.length ? diagnostics.fields.join(', ') : 'KEINE OPTIONALEN FELDER'}</p>
              <p>FEATURE: {diagnostics.featureHex}</p>
              <p>SENSOR: {diagnostics.sensorLocation}</p>
              <p>GATT: {diagnostics.characteristics.map((item) => item.uuid).join(' ') || 'UNBEKANNT'}</p>
            </div>
          )}

          {reconnectVisible && (
            <div className="absolute inset-0 grid place-items-center bg-[#b9bdaf]/80 p-5">
              <div className="border-2 border-black bg-[#c2c6b8] p-5 text-center font-mono text-black">
                <h2 className="text-xl font-black">VERBINDUNG GETRENNT</h2>
                <p className="mt-2 text-sm font-bold">{error || 'KEINE DATEN VOM PEDAL'}</p>
                <button type="button" onClick={reconnect} className="mt-4 border-2 border-black px-4 py-3 text-sm font-black">
                  WIEDERHERSTELLEN
                </button>
              </div>
            </div>
          )}
        </section>

        <div className="grid grid-cols-3 border-t border-black bg-black px-4 py-3 font-mono text-xs font-black text-zinc-200">
          <button type="button" onClick={() => setMenuOpen(true)} className="text-left">
            OPTIONEN
          </button>
          <div className="text-center">● ○ ○</div>
          <button
            type="button"
            onClick={() => {
              if (gpsState === 'active' || gpsState === 'starting') stopGps();
              else startGps();
            }}
            className="text-right"
          >
            GPS {gpsState === 'active' ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
    </main>
  );
}
