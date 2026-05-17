import { useEffect, useMemo, useRef, useState } from 'react';

const CYCLING_POWER_SERVICE = 0x1818;
const CYCLING_POWER_MEASUREMENT = 0x2a63;
const CRANK_REVOLUTION_DATA_PRESENT = 1 << 3;

const initialMetrics = {
  watts: 0,
  cadence: 0,
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

  if (flags & (1 << 0)) offset += 1; // Pedal Power Balance
  if (flags & (1 << 1)) offset += 2; // Accumulated Torque
  if (flags & (1 << 2)) offset += 6; // Wheel Revolution Data

  if (flags & CRANK_REVOLUTION_DATA_PRESENT && value.byteLength >= offset + 4) {
    crank = {
      revolutions: value.getUint16(offset, true),
      eventTime: value.getUint16(offset + 2, true), // 1/1024 second units
    };
    offset += 4;
  }

  if (flags & (1 << 4)) offset += 4; // Extreme Force Magnitudes
  if (flags & (1 << 5)) offset += 4; // Extreme Torque Magnitudes
  if (flags & (1 << 6)) offset += 3; // Extreme Angles
  if (flags & (1 << 7)) offset += 2; // Top Dead Spot Angle
  if (flags & (1 << 8)) offset += 2; // Bottom Dead Spot Angle
  if (flags & (1 << 9)) offset += 2; // Accumulated Energy

  return { flags, watts, crank };
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

export default function App() {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [connectionState, setConnectionState] = useState('idle');
  const [deviceName, setDeviceName] = useState('');
  const [error, setError] = useState('');
  const [lastPacketAt, setLastPacketAt] = useState(null);

  const deviceRef = useRef(null);
  const characteristicRef = useRef(null);
  const crankRef = useRef(null);
  const lastCadenceUpdateRef = useRef(0);
  const reconnectingRef = useRef(false);

  const connected = connectionState === 'connected';
  const reconnectVisible = connectionState === 'lost' || connectionState === 'error';
  const stale = connected && lastPacketAt && Date.now() - lastPacketAt > 3500;

  const cadenceProgress = Math.min(100, Math.max(0, (metrics.cadence / 130) * 100));
  const cadenceRing = `conic-gradient(rgb(34 211 238) ${cadenceProgress * 3.6}deg, rgb(30 41 59) 0deg)`;
  const zone = useMemo(() => powerZone(metrics.watts), [metrics.watts]);

  async function connect(existingDevice = deviceRef.current) {
    setError('');
    setConnectionState(existingDevice ? 'reconnecting' : 'scanning');

    try {
      const device =
        existingDevice ||
        (await navigator.bluetooth.requestDevice({
          filters: [{ services: [CYCLING_POWER_SERVICE] }],
          optionalServices: [CYCLING_POWER_SERVICE],
        }));

      deviceRef.current = device;
      setDeviceName(device.name || 'Cycling Power Pedal');
      device.addEventListener('gattserverdisconnected', handleDisconnected);

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(CYCLING_POWER_SERVICE);
      const characteristic = await service.getCharacteristic(CYCLING_POWER_MEASUREMENT);

      characteristicRef.current = characteristic;
      characteristic.addEventListener('characteristicvaluechanged', handleMeasurement);
      await characteristic.startNotifications();

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
    setMetrics((current) => {
      const nextSamples = current.samples + 1;
      const nextAverage = Math.round((current.avgWatts * current.samples + parsed.watts) / nextSamples);
      const nextZone = powerZone(parsed.watts);

      return {
        watts: parsed.watts,
        cadence: nextCadence ?? current.cadence,
        avgWatts: nextAverage,
        samples: nextSamples,
        zone: nextZone.zone,
        zoneColor: nextZone.zoneColor,
      };
    });
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!lastPacketAt || Date.now() - lastPacketAt <= 4500) return;
      setMetrics((current) => ({ ...current, cadence: 0, watts: 0 }));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [lastPacketAt]);

  useEffect(() => {
    return () => {
      const characteristic = characteristicRef.current;
      if (characteristic) {
        characteristic.removeEventListener('characteristicvaluechanged', handleMeasurement);
        characteristic.stopNotifications?.().catch(() => {});
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

          {connected ? (
            <div className="flex items-center gap-3 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-200 shadow-pulseGreen">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.9)]" />
              <span className="max-w-[11rem] truncate">{deviceName || 'Verbunden'}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => connect(null)}
              disabled={connectionState === 'scanning' || connectionState === 'reconnecting'}
              className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-bold text-cyan-100 shadow-glow transition hover:border-cyan-200 hover:bg-cyan-300/20 disabled:cursor-wait disabled:opacity-60"
            >
              {connectionState === 'scanning' ? 'Scanne...' : 'Pedale verbinden'}
            </button>
          )}
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

              <div className="mt-10 grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Durchschnitt</p>
                  <p className="mt-2 text-3xl font-black text-white">{metrics.avgWatts}<span className="text-base text-slate-500"> W</span></p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Pakete</p>
                  <p className="mt-2 text-3xl font-black text-white">{metrics.samples}</p>
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
          <span>{connected ? 'Live Cycling Power Profile 0x1818 / 0x2A63' : 'HTTPS und WebBLE-Browser erforderlich'}</span>
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
