import { useState } from 'react';
import { SevenText } from './SevenSegment';
import { formatDuration } from './utils';

export default function RideView({
  deviceName,
  metrics, zone, lcdDarkMode, reconnectVisible, stale,
  showDiagnostics, diagnostics, error,
  onReconnect, onSaveRide, onResetMetrics,
}) {
  const [saved, setSaved] = useState(false);

  function handleSave() {
    onSaveRide();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const avgSpeedKmh = metrics.movingSeconds > 0
    ? (metrics.distanceKm / (metrics.movingSeconds / 3600)).toFixed(1)
    : '--';

  const hasActivity = metrics.movingSeconds > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section
        style={{ filter: lcdDarkMode ? 'invert(1)' : 'none' }}
        className={`relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#b9bdaf] text-black transition-[filter,opacity] ${reconnectVisible || stale ? 'opacity-50' : ''}`}
      >
        <div className="grid flex-1 grid-cols-2 grid-rows-[1.6fr_1.1fr_1fr_1fr_1fr_1fr_auto] border-b border-black/70">

          {/* WATT */}
          <div className="col-span-2 flex flex-col border-b border-black/70 p-1.5 sm:p-2">
            <div className="font-mono text-[clamp(0.6rem,2.4vw,0.85rem)] font-black opacity-80">WATT</div>
            <div className="flex flex-1 items-center justify-center gap-2 font-mono tracking-normal">
              <SevenText value={Math.max(0, metrics.watts)} digitClassName="h-[clamp(4.2rem,22vw,7.5rem)] w-[clamp(2.4rem,12.5vw,4.2rem)]" />
              <span className="text-[clamp(1.1rem,4.5vw,1.8rem)] font-black">W</span>
            </div>
          </div>

          {/* KADENZ */}
          <div className="flex flex-col border-r border-black/70 p-2 sm:p-3">
            <div className="font-mono text-[clamp(0.58rem,2.2vw,0.8rem)] font-black opacity-80">KADENZ</div>
            <div className="flex flex-1 items-center justify-center gap-1 font-mono">
              <SevenText value={metrics.cadence} digitClassName="h-[clamp(2.8rem,15vw,4.5rem)] w-[clamp(1.55rem,8.5vw,2.5rem)]" />
              <span className="text-[clamp(0.65rem,2.5vw,0.9rem)] font-black">RPM</span>
            </div>
          </div>

          {/* GESCHW. */}
          <div className="flex flex-col p-2 sm:p-3">
            <div className="font-mono text-[clamp(0.58rem,2.2vw,0.8rem)] font-black opacity-80">GESCHW.</div>
            <div className="flex flex-1 items-center justify-center gap-1 font-mono">
              <SevenText value={metrics.speedKmh === null ? '--' : metrics.speedKmh.toFixed(1)} digitClassName="h-[clamp(2.8rem,15vw,4.5rem)] w-[clamp(1.55rem,8.5vw,2.5rem)]" />
              <span className="text-[clamp(0.6rem,2.3vw,0.85rem)] font-black">KM/H</span>
            </div>
          </div>

          {/* ZEIT */}
          <div className="flex flex-col border-t border-r border-black/70 p-2 sm:p-3">
            <div className="font-mono text-[clamp(0.58rem,2.2vw,0.8rem)] font-black opacity-80">ZEIT</div>
            <div className="flex flex-1 items-center justify-center font-mono">
              <SevenText value={formatDuration(metrics.movingSeconds)} digitClassName="h-[clamp(1.8rem,9vw,2.8rem)] w-[clamp(1rem,5vw,1.55rem)]" />
            </div>
          </div>

          {/* DISTANZ */}
          <div className="flex flex-col border-t border-black/70 p-2 sm:p-3">
            <div className="font-mono text-[clamp(0.58rem,2.2vw,0.8rem)] font-black opacity-80">DISTANZ</div>
            <div className="flex flex-1 items-center justify-center gap-1 font-mono">
              <SevenText value={metrics.distanceKm.toFixed(2)} digitClassName="h-[clamp(2.2rem,11vw,3.2rem)] w-[clamp(1.2rem,6vw,1.8rem)]" />
              <span className="text-[clamp(0.6rem,2.3vw,0.85rem)] font-black">KM</span>
            </div>
          </div>

          {/* Ø WATT */}
          <div className="flex flex-col border-t border-r border-black/70 p-2 sm:p-3">
            <div className="font-mono text-[clamp(0.58rem,2.2vw,0.8rem)] font-black opacity-80">Ø WATT</div>
            <div className="flex flex-1 items-center justify-center gap-1 font-mono">
              <SevenText value={metrics.avgWatts} digitClassName="h-[clamp(2.4rem,12vw,3.8rem)] w-[clamp(1.35rem,6.5vw,2.1rem)]" />
              <span className="text-[clamp(0.65rem,2.5vw,0.9rem)] font-black">W</span>
            </div>
          </div>

          {/* MAX WATT */}
          <div className="flex flex-col border-t border-black/70 p-2 sm:p-3">
            <div className="font-mono text-[clamp(0.58rem,2.2vw,0.8rem)] font-black opacity-80">MAX WATT</div>
            <div className="flex flex-1 items-center justify-center gap-1 font-mono">
              <SevenText value={metrics.maxWatts} digitClassName="h-[clamp(2.4rem,12vw,3.8rem)] w-[clamp(1.35rem,6.5vw,2.1rem)]" />
              <span className="text-[clamp(0.65rem,2.5vw,0.9rem)] font-black">W</span>
            </div>
          </div>

          {/* Ø KM/H */}
          <div className="flex flex-col border-t border-r border-black/70 p-2 sm:p-3">
            <div className="font-mono text-[clamp(0.58rem,2.2vw,0.8rem)] font-black opacity-80">Ø KM/H</div>
            <div className="flex flex-1 items-center justify-center gap-1 font-mono">
              <SevenText value={avgSpeedKmh} digitClassName="h-[clamp(2.2rem,11vw,3.2rem)] w-[clamp(1.2rem,6vw,1.8rem)]" />
              <span className="text-[clamp(0.6rem,2.3vw,0.85rem)] font-black">KM/H</span>
            </div>
          </div>

          {/* MAX KM/H */}
          <div className="flex flex-col border-t border-black/70 p-2 sm:p-3">
            <div className="font-mono text-[clamp(0.58rem,2.2vw,0.8rem)] font-black opacity-80">MAX KM/H</div>
            <div className="flex flex-1 items-center justify-center gap-1 font-mono">
              <SevenText value={metrics.maxSpeedKmh ? metrics.maxSpeedKmh.toFixed(1) : '--'} digitClassName="h-[clamp(2.2rem,11vw,3.2rem)] w-[clamp(1.2rem,6vw,1.8rem)]" />
              <span className="text-[clamp(0.6rem,2.3vw,0.85rem)] font-black">KM/H</span>
            </div>
          </div>

          {/* KJ */}
          <div className="flex flex-col border-t border-r border-black/70 p-2 sm:p-3">
            <div className="font-mono text-[clamp(0.58rem,2.2vw,0.8rem)] font-black opacity-80">KJ</div>
            <div className="flex flex-1 items-center justify-center font-mono">
              <SevenText value={Math.round(metrics.energyKj)} digitClassName="h-[clamp(2.4rem,12vw,3.8rem)] w-[clamp(1.35rem,6.5vw,2.1rem)]" />
            </div>
          </div>

          {/* BALANCE */}
          <div className="flex flex-col border-t border-black/70 p-2 sm:p-3">
            <div className="font-mono text-[clamp(0.58rem,2.2vw,0.8rem)] font-black opacity-80">BALANCE</div>
            <div className="flex flex-1 items-center justify-center font-mono">
              <SevenText
                value={
                  metrics.balance === null
                    ? '--'
                    : metrics.balanceReference === 'right'
                      ? `${Math.round(100 - metrics.balance)}/${Math.round(metrics.balance)}`
                      : `${Math.round(metrics.balance)}/${Math.round(100 - metrics.balance)}`
                }
                digitClassName="h-[clamp(2.4rem,12vw,3.8rem)] w-[clamp(1.35rem,6.5vw,2.1rem)]"
              />
            </div>
          </div>

          {/* ZONE */}
          <div className="col-span-2 border-t border-black/70 p-2">
            <div className="mb-1 flex justify-between font-mono text-[clamp(0.58rem,2.3vw,0.78rem)] font-black">
              <span>ZONE</span>
              <span>{zone.zone.toUpperCase()}</span>
            </div>
            <div className="grid h-3 grid-cols-[repeat(16,minmax(0,1fr))] gap-px border border-black bg-black p-px">
              {Array.from({ length: 16 }).map((_, i) => {
                const active = i < Math.max(1, Math.round((parseFloat(zone.width) / 100) * 16));
                return <span key={i} className={active ? 'bg-black' : 'bg-[#9da294]'} />;
              })}
            </div>
          </div>
        </div>

        {/* Diagnose-Overlay */}
        {showDiagnostics && (
          <div className="absolute inset-x-0 bottom-0 max-h-[40%] overflow-auto border-t-2 border-black bg-[#b9bdaf] p-3 font-mono text-xs font-bold leading-5">
            <div className="flex justify-between">
              <span>FLAGS {metrics.flagsHex}</span>
              <span>{diagnostics.byteLength ? `${diagnostics.byteLength} BYTES` : 'WARTET'}</span>
            </div>
            <p className="mt-1 break-all">{diagnostics.rawHex || 'NOCH KEIN MEASUREMENT'}</p>
            <p className="mt-1">FELDER: {diagnostics.fields.length ? diagnostics.fields.join(', ') : 'KEINE'}</p>
            <p>FEATURE: {diagnostics.featureHex}</p>
            <p>SENSOR: {diagnostics.sensorLocation}</p>
            <p>GATT: {diagnostics.characteristics.map((c) => c.uuid).join(' ') || 'UNBEKANNT'}</p>
          </div>
        )}

        {/* Verbindung getrennt */}
        {reconnectVisible && (
          <div className="absolute inset-0 grid place-items-center bg-[#b9bdaf]/80 p-5">
            <div className="border-2 border-black bg-[#c2c6b8] p-5 text-center font-mono text-black">
              <h2 className="text-xl font-black">VERBINDUNG GETRENNT</h2>
              <p className="mt-2 text-sm font-bold">{error || (deviceName ? `PEDAL "${deviceName.toUpperCase()}" NICHT BEREIT` : 'KEINE DATEN VOM PEDAL')}</p>
              <button type="button" onClick={onReconnect} className="mt-4 border-2 border-black px-4 py-3 text-sm font-black">
                WIEDERHERSTELLEN
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Aktionsleiste */}
      <div className="flex gap-2 border-t border-zinc-800 bg-zinc-900 px-3 py-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasActivity}
          className="flex-1 rounded border border-zinc-700 py-2 font-mono text-xs font-black text-zinc-100 disabled:opacity-30"
        >
          {saved ? 'GESPEICHERT ✓' : 'SPEICHERN'}
        </button>
        <button
          type="button"
          onClick={onResetMetrics}
          disabled={!hasActivity}
          className="rounded border border-zinc-700 px-4 py-2 font-mono text-xs font-black text-zinc-500 disabled:opacity-30"
        >
          NEU
        </button>
      </div>
    </div>
  );
}
