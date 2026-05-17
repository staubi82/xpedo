import { useEffect, useMemo, useRef, useState } from 'react';
import RideView from './RideView';
import HistoryView from './HistoryView';
import SettingsView from './SettingsView';
import { distanceInKm, powerZone } from './utils';

// ─── BLE constants ────────────────────────────────────────────────────────────
const CYCLING_POWER_SERVICE      = 0x1818;
const CYCLING_POWER_MEASUREMENT  = 0x2a63;
const CYCLING_POWER_FEATURE      = 0x2a65;
const CYCLING_POWER_CONTROL_POINT = 0x2a66;
const SENSOR_LOCATION            = 0x2a5d;
const START_OFFSET_COMPENSATION  = 0x0c;
const CONTROL_POINT_RESPONSE     = 0x20;
const RESPONSE_SUCCESS           = 0x01;
const GPS_STOP_SPEED_KMH         = 5;
const GPS_DRIFT_DISTANCE_KM      = 0.015;
const PEDAL_POWER_BALANCE_PRESENT      = 1 << 0;
const ACCUMULATED_TORQUE_PRESENT       = 1 << 2;
const WHEEL_REVOLUTION_DATA_PRESENT    = 1 << 4;
const CRANK_REVOLUTION_DATA_PRESENT    = 1 << 5;
const EXTREME_FORCE_MAGNITUDES_PRESENT = 1 << 6;
const EXTREME_TORQUE_MAGNITUDES_PRESENT = 1 << 7;
const EXTREME_ANGLES_PRESENT           = 1 << 8;
const TOP_DEAD_SPOT_ANGLE_PRESENT      = 1 << 9;
const BOTTOM_DEAD_SPOT_ANGLE_PRESENT   = 1 << 10;
const ACCUMULATED_ENERGY_PRESENT       = 1 << 11;

// ─── Initial state ────────────────────────────────────────────────────────────
const initialMetrics = {
  watts: 0, cadence: 0, speedKmh: null, maxSpeedKmh: 0,
  distanceKm: 0, movingSeconds: 0, energyKj: 0,
  balance: null, balanceReference: 'unknown',
  flagsHex: '0x0000', avgWatts: 0, maxWatts: 0, samples: 0,
  zone: 'Bereit', zoneColor: 'from-cyan-400 to-emerald-300',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function readCyclingPowerMeasurement(value) {
  const flags = value.getUint16(0, true);
  const watts = value.getInt16(2, true);
  const rawHex = Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    .map((b) => b.toString(16).padStart(2, '0')).join(' ');
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
    crank = { revolutions: value.getUint16(offset, true), eventTime: value.getUint16(offset + 2, true) };
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

function controlPointResponseText(v) {
  switch (v) {
    case RESPONSE_SUCCESS: return 'Kalibrierung abgeschlossen';
    case 0x02: return 'Kalibrierung nicht unterstuetzt';
    case 0x03: return 'Ungueltige Kalibrierparameter';
    case 0x04: return 'Kalibrierung fehlgeschlagen';
    default: return `Unbekannte Antwort 0x${v.toString(16).padStart(2, '0')}`;
  }
}

function shortUuid(uuid) {
  const m = uuid.match(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i);
  return m ? `0x${m[1].toUpperCase()}` : uuid;
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

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('ride');
  const [metrics, setMetrics] = useState(initialMetrics);
  const [connectionState, setConnectionState] = useState('idle');
  const [deviceName, setDeviceName] = useState('');
  const [error, setError] = useState('');
  const [lastPacketAt, setLastPacketAt] = useState(null);
  const [calibrationState, setCalibrationState] = useState('unknown');
  const [calibrationMessage, setCalibrationMessage] = useState('Noch nicht kalibriert');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [lcdDarkMode, setLcdDarkMode] = useState(() => localStorage.getItem('xpedo-lcd-dark') === '1');
  const [ftp, setFtp] = useState(() => parseInt(localStorage.getItem('xpedo-ftp') || '250', 10));
  const [gpsAlwaysOn, setGpsAlwaysOn] = useState(() => localStorage.getItem('xpedo-gps-always') === '1');
  const [gpsState, setGpsState] = useState('off');
  const [gpsMessage, setGpsMessage] = useState('GPS aus');
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [rides, setRides] = useState(() => JSON.parse(localStorage.getItem('xpedo-rides') || '[]'));
  const [diagnostics, setDiagnostics] = useState({
    rawHex: '', byteLength: 0, fields: [], characteristics: [],
    featureHex: 'nicht gelesen', sensorLocation: 'nicht gelesen',
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
  const ftpRef = useRef(ftp);
  const trackRef = useRef([]);
  const lastTrackPointRef = useRef(null);

  const connected = connectionState === 'connected';
  const reconnectVisible = connectionState === 'lost' || connectionState === 'error';
  const stale = connected && lastPacketAt && Date.now() - lastPacketAt > 3500;
  const zone = useMemo(() => powerZone(metrics.watts, ftp), [metrics.watts, ftp]);

  const gpsBars =
    gpsState !== 'active' || gpsAccuracy === null ? 0
    : gpsAccuracy <= 5  ? 4
    : gpsAccuracy <= 10 ? 3
    : gpsAccuracy <= 25 ? 2
    : gpsAccuracy <= 50 ? 1 : 0;

  // ─── BLE ──────────────────────────────────────────────────────────────────
  async function connect(existingDevice = deviceRef.current) {
    setError('');
    if (!window.isSecureContext) {
      setError('Web Bluetooth braucht HTTPS oder localhost.');
      setConnectionState('error');
      return;
    }
    if (!navigator.bluetooth) {
      setError('Kein Web Bluetooth. Bitte Chrome, Chromium oder Edge verwenden.');
      setConnectionState('error');
      return;
    }
    setConnectionState(existingDevice ? 'reconnecting' : 'scanning');
    try {
      const device = existingDevice || (await navigator.bluetooth.requestDevice({
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

      setDiagnostics((c) => ({
        ...c,
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
        const cp = await service.getCharacteristic(CYCLING_POWER_CONTROL_POINT);
        controlPointRef.current = cp;
        cp.addEventListener('characteristicvaluechanged', handleControlPoint);
        await cp.startNotifications();
        setCalibrationState('ready');
        setCalibrationMessage('Bereit fuer Nullstellen-Kalibrierung');
      } catch {
        controlPointRef.current = null;
        setCalibrationState('unsupported');
        setCalibrationMessage('Kalibrierung vom Pedal nicht freigegeben');
      }
      setConnectionState('connected');
      setLastPacketAt(Date.now());
    } catch (err) {
      const msg = err?.name === 'NotFoundError' ? 'Kein Pedal ausgewählt.' : err?.message || 'Bluetooth-Verbindung fehlgeschlagen.';
      setError(msg);
      setConnectionState(deviceRef.current ? 'lost' : 'error');
    }
  }

  async function calibratePedal() {
    const cp = controlPointRef.current;
    if (!connected || !cp) { setCalibrationState('unsupported'); setCalibrationMessage('Control Point nicht verfuegbar'); return; }
    setCalibrationState('running');
    setCalibrationMessage('Pedal ruhig halten...');
    try {
      const result = await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => { calibrationResolverRef.current = null; reject(new Error('Keine Antwort vom Pedal')); }, 12000);
        calibrationResolverRef.current = (response) => { window.clearTimeout(timeout); resolve(response); };
        cp.writeValueWithResponse(new Uint8Array([START_OFFSET_COMPENSATION])).catch((e) => {
          window.clearTimeout(timeout); calibrationResolverRef.current = null; reject(e);
        });
      });
      setCalibrationState(result.success ? 'success' : 'error');
      setCalibrationMessage(result.message);
    } catch (e) {
      setCalibrationState('error');
      setCalibrationMessage(e?.message || 'Kalibrierung fehlgeschlagen');
    }
  }

  async function readOptionalDiagnostics(service) {
    try {
      const feat = await service.getCharacteristic(CYCLING_POWER_FEATURE);
      const v = await feat.readValue();
      const hex = v.byteLength >= 4 ? `0x${v.getUint32(0, true).toString(16).padStart(8, '0')}` : 'zu kurz';
      setDiagnostics((c) => ({ ...c, featureHex: hex }));
    } catch { setDiagnostics((c) => ({ ...c, featureHex: 'nicht verfuegbar' })); }
    try {
      const sl = await service.getCharacteristic(SENSOR_LOCATION);
      const v = await sl.readValue();
      setDiagnostics((c) => ({ ...c, sensorLocation: String(v.getUint8(0)) }));
    } catch { setDiagnostics((c) => ({ ...c, sensorLocation: 'nicht verfuegbar' })); }
  }

  function handleDisconnected() {
    setConnectionState('lost');
    if (localStorage.getItem('xpedo-auto-connect') === '1') {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(() => reconnect(), 1800);
    }
  }

  async function reconnect() {
    if (!deviceRef.current || reconnectingRef.current) { await connect(null); return; }
    reconnectingRef.current = true;
    try { await connect(deviceRef.current); } finally { reconnectingRef.current = false; }
  }

  function handleMeasurement(event) {
    const parsed = readCyclingPowerMeasurement(event.target.value);
    const now = Date.now();
    let nextCadence = null;
    const fields = describeMeasurementFlags(parsed.flags);

    if (parsed.crank) {
      const prev = crankRef.current;
      if (prev) {
        const revDelta = deltaWithRollover(parsed.crank.revolutions, prev.revolutions, 65536);
        const timeDelta = deltaWithRollover(parsed.crank.eventTime, prev.eventTime, 65536);
        if (timeDelta > 0) {
          if (now - lastCadenceUpdateRef.current >= 900) {
            nextCadence = Math.round((revDelta / (timeDelta / 1024)) * 60);
            lastCadenceUpdateRef.current = now;
          }
        } else if (now - lastCadenceUpdateRef.current > 2000) {
          nextCadence = 0;
        }
      } else {
        lastCadenceUpdateRef.current = now;
      }
      crankRef.current = parsed.crank;
    } else if (lastCadenceUpdateRef.current > 0 && now - lastCadenceUpdateRef.current > 2000) {
      nextCadence = 0;
    }

    setLastPacketAt(now);
    setDiagnostics((c) => ({ ...c, rawHex: parsed.rawHex, byteLength: parsed.byteLength, fields: fields.map(([l]) => l) }));
    if (parsed.watts > 0 || (nextCadence ?? 0) > 0) lastMovementAtRef.current = now;

    // Filter unrealistic power spikes (e.g. > 1200W) to prevent fantasy max values
    const filteredWatts = parsed.watts > 1200 ? 0 : parsed.watts;

    setMetrics((current) => {
      const nextSamples = current.samples + 1;
      const nextAvg = Math.round((current.avgWatts * current.samples + filteredWatts) / nextSamples);
      const nextZone = powerZone(filteredWatts, ftpRef.current);
      return {
        ...current,
        watts: filteredWatts,
        cadence: nextCadence ?? current.cadence,
        balance: parsed.balance ?? current.balance,
        balanceReference: parsed.balance ? parsed.balanceReference : current.balanceReference,
        flagsHex: `0x${parsed.flags.toString(16).padStart(4, '0')}`,
        avgWatts: nextAvg,
        maxWatts: Math.max(current.maxWatts, filteredWatts),
        samples: nextSamples,
        zone: nextZone.zone,
        zoneColor: nextZone.zoneColor,
      };
    });
  }

  function handleControlPoint(event) {
    const value = event.target.value;
    if (value.byteLength < 3 || value.getUint8(0) !== CONTROL_POINT_RESPONSE) return;
    if (value.getUint8(1) !== START_OFFSET_COMPENSATION) return;
    const responseValue = value.getUint8(2);
    let message = controlPointResponseText(responseValue);
    if (responseValue === RESPONSE_SUCCESS && value.byteLength >= 5) {
      message = `Offset ${value.getInt16(3, true)}`;
    }
    calibrationResolverRef.current?.({ success: responseValue === RESPONSE_SUCCESS, message });
    calibrationResolverRef.current = null;
  }

  // ─── GPS ──────────────────────────────────────────────────────────────────
  function startGps() {
    if (!navigator.geolocation) { setGpsState('error'); setGpsMessage('GPS nicht verfuegbar'); return; }
    setGpsState('starting');
    setGpsMessage('GPS wird aktiviert...');
    setGpsAccuracy(null);
    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed, accuracy } = position.coords;
        const cur = { latitude, longitude, timestamp: position.timestamp };
        let speedKmh = typeof speed === 'number' && speed >= 0 ? speed * 3.6 : null;
        let distanceDelta = 0;
        if (lastPositionRef.current) {
          const secDelta = (position.timestamp - lastPositionRef.current.timestamp) / 1000;
          distanceDelta = distanceInKm(lastPositionRef.current, cur);
          if ((speedKmh === null || speedKmh < 1) && secDelta > 0 && distanceDelta < 0.5) {
            speedKmh = distanceDelta / (secDelta / 3600);
          }
          if (accuracy > 40 || distanceDelta > 0.5) distanceDelta = 0;
        }
        if ((speedKmh ?? 0) < GPS_STOP_SPEED_KMH) {
          speedKmh = 0;
          if (distanceDelta < GPS_DRIFT_DISTANCE_KM) distanceDelta = 0;
        }
        lastPositionRef.current = cur;

        // Track recording — only when accuracy is good and moved ≥ 5 m
        if (accuracy <= 40) {
          const lastTp = lastTrackPointRef.current;
          const movedEnough = !lastTp || distanceInKm(lastTp, cur) >= 0.005;
          if (movedEnough) {
            trackRef.current.push([
              parseFloat(latitude.toFixed(5)),
              parseFloat(longitude.toFixed(5)),
            ]);
            lastTrackPointRef.current = cur;
          }
        }

        setGpsState('active');
        setGpsAccuracy(accuracy);
        setGpsMessage(`GPS aktiv, Genauigkeit ${Math.round(accuracy)} m`);
        setMetrics((c) => ({
          ...c, speedKmh,
          maxSpeedKmh: Math.max(c.maxSpeedKmh, speedKmh ?? 0),
          distanceKm: c.distanceKm + distanceDelta,
        }));
        if ((speedKmh ?? 0) > 2) lastMovementAtRef.current = Date.now();
      },
      (err) => { setGpsState('error'); setGpsAccuracy(null); setGpsMessage(err?.message || 'GPS Fehler'); },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 },
    );
  }

  function stopGps() {
    if (gpsWatchRef.current !== null) { navigator.geolocation.clearWatch(gpsWatchRef.current); gpsWatchRef.current = null; }
    lastPositionRef.current = null;
    setGpsState('off');
    setGpsAccuracy(null);
    setGpsMessage('GPS aus');
    setMetrics((c) => ({ ...c, speedKmh: null }));
  }

  // ─── Ride management ──────────────────────────────────────────────────────
  function saveRide() {
    if (metrics.movingSeconds < 10) return;
    const ride = {
      id: Date.now(),
      date: new Date().toISOString(),
      durationSeconds: metrics.movingSeconds,
      distanceKm: metrics.distanceKm,
      avgWatts: metrics.avgWatts,
      maxWatts: metrics.maxWatts,
      avgSpeedKmh: metrics.movingSeconds > 0 ? metrics.distanceKm / (metrics.movingSeconds / 3600) : 0,
      maxSpeedKmh: metrics.maxSpeedKmh,
      energyKj: Math.round(metrics.energyKj),
      track: trackRef.current.length >= 2 ? trackRef.current.slice() : [],
    };
    setRides((prev) => {
      const next = [ride, ...prev];
      localStorage.setItem('xpedo-rides', JSON.stringify(next));
      return next;
    });
  }

  function deleteRide(id) {
    setRides((prev) => {
      const next = prev.filter((r) => r.id !== id);
      localStorage.setItem('xpedo-rides', JSON.stringify(next));
      return next;
    });
  }

  function resetMetrics() {
    setMetrics(initialMetrics);
    setLastPacketAt(null);
    crankRef.current = null;
    lastPositionRef.current = null;
    lastMovementAtRef.current = 0;
    trackRef.current = [];
    lastTrackPointRef.current = null;
  }

  // ─── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!lastPacketAt || Date.now() - lastPacketAt <= 4500) return;
      setMetrics((c) => ({ ...c, cadence: 0, watts: 0 }));
    }, 1000);
    return () => window.clearInterval(t);
  }, [lastPacketAt]);

  useEffect(() => {
    const t = window.setInterval(() => {
      if (Date.now() - lastMovementAtRef.current > 2500) return;
      setMetrics((c) => ({
        ...c,
        movingSeconds: c.movingSeconds + 1,
        energyKj: c.energyKj + Math.max(0, c.watts) / 1000,
      }));
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function autoConnect() {
      if (!navigator.bluetooth?.getDevices || localStorage.getItem('xpedo-auto-connect') !== '1') return;
      try {
        const devices = await navigator.bluetooth.getDevices();
        if (!cancelled && devices.length > 0) await connect(devices[0]);
      } catch {}
    }
    autoConnect();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (gpsAlwaysOn && gpsState === 'off') startGps();
    if (!gpsAlwaysOn && (gpsState === 'active' || gpsState === 'starting')) stopGps();
  }, [gpsAlwaysOn]);

  useEffect(() => { ftpRef.current = ftp; localStorage.setItem('xpedo-ftp', String(ftp)); }, [ftp]);
  useEffect(() => { localStorage.setItem('xpedo-lcd-dark', lcdDarkMode ? '1' : '0'); }, [lcdDarkMode]);
  useEffect(() => { localStorage.setItem('xpedo-gps-always', gpsAlwaysOn ? '1' : '0'); }, [gpsAlwaysOn]);

  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let wakeLock = null;
    async function acquire() { try { wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
    function onVisibility() { if (document.visibilityState === 'visible') acquire(); }
    acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); wakeLock?.release().catch(() => {}); };
  }, []);

  useEffect(() => {
    return () => {
      window.clearTimeout(reconnectTimerRef.current);
      const c = characteristicRef.current;
      if (c) { c.removeEventListener('characteristicvaluechanged', handleMeasurement); c.stopNotifications?.().catch(() => {}); }
      const cp = controlPointRef.current;
      if (cp) { cp.removeEventListener('characteristicvaluechanged', handleControlPoint); cp.stopNotifications?.().catch(() => {}); }
      if (gpsWatchRef.current !== null) navigator.geolocation.clearWatch(gpsWatchRef.current);
      deviceRef.current?.removeEventListener('gattserverdisconnected', handleDisconnected);
      deviceRef.current?.gatt?.disconnect();
    };
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <main className="h-[100svh] overflow-hidden bg-zinc-950 p-1 text-zinc-100 antialiased sm:p-3">
      <div className="mx-auto flex h-full w-full max-w-[460px] flex-col overflow-hidden rounded-[1rem] border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black sm:rounded-[1.6rem]">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-black bg-black px-3 py-2 font-mono text-xs font-black">
          <span className="text-zinc-100 sm:text-sm">XPEDO</span>
          <div className="flex items-center gap-3">
            <span className={connected ? 'text-lime-300' : 'text-zinc-600'}>BLE</span>
            <span
              className="flex items-end gap-1"
              title={gpsAccuracy === null ? gpsMessage : `GPS ${Math.round(gpsAccuracy)} m`}
            >
              <span className={gpsState === 'active' ? 'text-lime-300' : 'text-zinc-600'}>GPS</span>
              {[1, 2, 3, 4].map((bar) => (
                <span
                  key={bar}
                  className={`block w-1 border border-zinc-600 ${gpsBars >= bar ? 'bg-lime-300' : 'bg-transparent'}`}
                  style={{ height: `${bar * 3 + 3}px` }}
                />
              ))}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {tab === 'ride' && (
            <RideView
              metrics={metrics}
              zone={zone}
              lcdDarkMode={lcdDarkMode}
              reconnectVisible={reconnectVisible}
              stale={stale}
              showDiagnostics={showDiagnostics}
              diagnostics={diagnostics}
              error={error}
              onReconnect={reconnect}
              onSaveRide={saveRide}
              onResetMetrics={resetMetrics}
            />
          )}
          {tab === 'history' && (
            <HistoryView rides={rides} onDelete={deleteRide} />
          )}
          {tab === 'settings' && (
            <SettingsView
              ftp={ftp} setFtp={setFtp}
              gpsAlwaysOn={gpsAlwaysOn} setGpsAlwaysOn={setGpsAlwaysOn}
              lcdDarkMode={lcdDarkMode} setLcdDarkMode={setLcdDarkMode}
              showDiagnostics={showDiagnostics} setShowDiagnostics={setShowDiagnostics}
              connected={connected} deviceName={deviceName} connectionState={connectionState}
              calibrationState={calibrationState} calibrationMessage={calibrationMessage}
              gpsState={gpsState} gpsMessage={gpsMessage}
              diagnostics={diagnostics} metrics={metrics}
              onConnect={() => connect(null)}
              onCalibrate={calibratePedal}
            />
          )}
        </div>

        {/* Footer Tab Bar */}
        <nav className="grid grid-cols-3 border-t border-zinc-800 bg-zinc-950">
          {[
            { id: 'ride',     label: 'FAHRT'    },
            { id: 'history',  label: 'FAHRTEN'  },
            { id: 'settings', label: 'EINST.'   },
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`py-3 font-mono text-xs font-black transition-colors ${
                tab === id
                  ? 'border-t-2 border-lime-400 text-lime-300'
                  : 'border-t-2 border-transparent text-zinc-600 hover:text-zinc-400'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
    </main>
  );
}
