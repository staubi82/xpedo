import { useEffect, useMemo, useRef, useState } from 'react';

const CYCLING_POWER_SERVICE = 0x1818;
const CYCLING_POWER_MEASUREMENT = 0x2a63;
const CYCLING_POWER_CONTROL_POINT = 0x2a66;
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

  return { flags, watts, crank, balance, balanceReference };
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
  const [gpsState, setGpsState] = useState('off');
  const [gpsMessage, setGpsMessage] = useState('GPS aus');

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
    if (parsed.watts > 0 || (nextCadence ?? metrics.cadence) > 0) {
      lastMovementAtRef.current = now;
    }

    setMetrics((current) => {
      const nextSamples = current.samples + 1;
      const nextAverage = Math.round((current.avgWatts * current.samples + parsed.watts) / nextSamples);
      const nextZone = powerZone(parsed.watts);

      return {
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
    <main className="min-h-screen overflow-hidden bg-slate-950 text-slate-100 antialiased">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_20%_78%,rgba(34,197,94,0.10),transparent_30%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/70">Cycling Power</p>
            <h1 className="mt-1 text-xl font-bold text-white sm:text-2xl">Xpedo Dashboard</h1>
          </div>

          <div className="relative flex items-center gap-2">
            {connected && (
              <div className="flex items-center gap-3 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-200 shadow-pulseGreen">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.9)]" />
                <span className="max-w-[8rem] truncate sm:max-w-[11rem]">{deviceName || 'Verbunden'}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-100 shadow-glow transition hover:border-cyan-300/40 hover:bg-cyan-300/10"
              aria-label="Menue"
            >
              <span className="space-y-1.5">
                <span className="block h-0.5 w-5 rounded-full bg-current" />
                <span className="block h-0.5 w-5 rounded-full bg-current" />
                <span className="block h-0.5 w-5 rounded-full bg-current" />
              </span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-14 z-20 w-72 overflow-hidden rounded-3xl border border-white/10 bg-slate-950/95 p-3 shadow-2xl shadow-cyan-950/40 backdrop-blur">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    connect(null);
                  }}
                  disabled={connectionState === 'scanning' || connectionState === 'reconnecting'}
                  className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-bold text-slate-100 transition hover:bg-white/8 disabled:cursor-wait disabled:opacity-50"
                >
                  <span>{connected ? 'Pedal neu verbinden' : 'Pedale verbinden'}</span>
                  <span className="text-cyan-300">{connectionState === 'scanning' ? '...' : 'BLE'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    calibratePedal();
                  }}
                  disabled={!connected || calibrationState === 'running' || calibrationState === 'unsupported'}
                  className="mt-1 flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-bold text-slate-100 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{calibrationState === 'running' ? 'Kalibriert...' : 'Kalibrieren'}</span>
                  <span className="text-cyan-300">0x2A66</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    if (gpsState === 'active' || gpsState === 'starting') {
                      stopGps();
                    } else {
                      startGps();
                    }
                  }}
                  className="mt-1 flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-bold text-slate-100 transition hover:bg-white/8"
                >
                  <span>{gpsState === 'active' || gpsState === 'starting' ? 'GPS stoppen' : 'GPS aktivieren'}</span>
                  <span className={gpsState === 'active' ? 'text-emerald-300' : 'text-cyan-300'}>
                    {gpsState === 'starting' ? '...' : gpsState === 'active' ? 'ON' : 'GPS'}
                  </span>
                </button>
                <div className="mt-2 rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Status</p>
                  <p className="mt-2 text-sm font-semibold text-slate-300">{connected ? deviceName || 'Verbunden' : 'Nicht verbunden'}</p>
                  <p className="mt-1 text-xs text-slate-500">{calibrationMessage}</p>
                  <p className="mt-1 text-xs text-slate-500">{gpsMessage}</p>
                </div>
              </div>
            )}
          </div>
        </header>

        <section
          className={`grid flex-1 place-items-center transition duration-500 ${
            reconnectVisible || stale ? 'opacity-35 blur-[1px]' : 'opacity-100'
          }`}
        >
          <div className="grid w-full gap-5 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.035] p-6 shadow-2xl backdrop-blur sm:p-8">
              <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/60 to-transparent" />
              <div className="flex items-start justify-between gap-5">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Leistung</p>
                  <div className="mt-3 flex items-end gap-3">
                    <span className="font-display text-7xl font-black leading-none text-cyan-300 drop-shadow-[0_0_28px_rgba(34,211,238,0.42)] sm:text-8xl">
                      {Math.max(0, metrics.watts)}
                    </span>
                    <span className="pb-3 text-2xl font-extrabold text-slate-400">W</span>
                  </div>
                </div>
                <div className={`rounded-full bg-gradient-to-r ${zone.zoneColor} px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-slate-950`}>
                  {zone.zone}
                </div>
              </div>

              <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Speed</p>
                  <p className="mt-2 text-3xl font-black text-white">
                    {metrics.speedKmh === null ? '--' : metrics.speedKmh.toFixed(1)}
                    <span className="text-base text-slate-500"> km/h</span>
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Bewegung</p>
                  <p className="mt-2 text-2xl font-black text-white">{formatDuration(metrics.movingSeconds)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Durchschnitt</p>
                  <p className="mt-2 text-3xl font-black text-white">{metrics.avgWatts}<span className="text-base text-slate-500"> W</span></p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Pakete</p>
                  <p className="mt-2 text-3xl font-black text-white">{metrics.samples}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Offset</p>
                  <p
                    className={`mt-2 truncate text-sm font-black ${
                      calibrationState === 'success'
                        ? 'text-emerald-300'
                        : calibrationState === 'error'
                          ? 'text-rose-300'
                          : calibrationState === 'running'
                            ? 'text-cyan-300'
                            : 'text-slate-300'
                    }`}
                    title={calibrationMessage}
                  >
                    {calibrationMessage}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Balance</p>
                  <p className="mt-2 text-xl font-black text-white">
                    {metrics.balance === null
                      ? '--'
                      : metrics.balanceReference === 'right'
                        ? `${Math.round(100 - metrics.balance)}/${Math.round(metrics.balance)}`
                        : `${Math.round(metrics.balance)}/${Math.round(100 - metrics.balance)}`}
                  </p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">L/R</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Distanz</p>
                  <p className="mt-2 text-3xl font-black text-white">
                    {metrics.distanceKm.toFixed(2)}
                    <span className="text-base text-slate-500"> km</span>
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                  <span>Flags</span>
                  <span className="font-mono text-cyan-300">{metrics.flagsHex}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[
                    ['Balance', metrics.balance !== null],
                    ['Kadenz', Boolean(crankRef.current)],
                    ['Control', Boolean(controlPointRef.current)],
                    ['Auto', autoConnectAvailable],
                    ['GPS', gpsState === 'active'],
                  ].map(([label, active]) => (
                    <span
                      key={label}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${
                        active ? 'bg-cyan-300/15 text-cyan-200' : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                  <span>Power Zone</span>
                  <span>{zone.zone}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${zone.zoneColor} shadow-[0_0_24px_rgba(34,211,238,0.34)] transition-all duration-500`}
                    style={{ width: zone.width }}
                  />
                </div>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.035] p-6 text-center shadow-2xl backdrop-blur sm:p-8">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Kadenz</p>
              <div className="mx-auto mt-7 grid aspect-square w-64 max-w-full place-items-center rounded-full p-3" style={{ background: cadenceRing }}>
                <div className="grid h-full w-full place-items-center rounded-full border border-white/10 bg-slate-950 shadow-inner">
                  <div>
                    <p className="text-6xl font-black leading-none text-white">{metrics.cadence}</p>
                    <p className="mt-2 text-sm font-black uppercase tracking-[0.26em] text-cyan-300">RPM</p>
                  </div>
                </div>
              </div>
              <div className="mt-7 flex justify-center gap-2">
                {[70, 90, 110].map((mark) => (
                  <div
                    key={mark}
                    className={`h-2 w-12 rounded-full transition ${
                      metrics.cadence >= mark ? 'bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.7)]' : 'bg-slate-800'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <footer className="flex min-h-10 items-center justify-between gap-4 text-xs font-medium text-slate-500">
          <span>
            {connected
              ? 'Live Cycling Power Profile 0x1818 / 0x2A63'
              : autoConnectAvailable
                ? 'Automatische Wiederverbindung aktiv'
                : 'HTTPS und WebBLE-Browser erforderlich'}
          </span>
          <span>{lastPacketAt ? `Letztes Paket ${Math.max(0, Math.round((Date.now() - lastPacketAt) / 1000))}s` : 'Noch keine Daten'}</span>
        </footer>

        {reconnectVisible && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/52 px-6 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-[2rem] border border-cyan-300/20 bg-slate-950/92 p-6 text-center shadow-glow">
              <div className="mx-auto h-3 w-3 animate-ping rounded-full bg-cyan-300" />
              <h2 className="mt-5 text-2xl font-black text-white">Verbindung getrennt</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{error || 'Das Pedal sendet keine Bluetooth-Daten mehr.'}</p>
              <button
                type="button"
                onClick={reconnect}
                className="mt-6 w-full rounded-full bg-cyan-300 px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-slate-950 shadow-glow transition hover:bg-cyan-200"
              >
                Verbindung wiederherstellen
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
