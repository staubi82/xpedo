import { lazy, Suspense, useState } from 'react';
import { formatDuration } from './utils';

const RideMap = lazy(() => import('./RideMap'));

const FIELDS = [
  { key: 'durationSeconds', label: 'ZEIT',     fmt: (v) => formatDuration(v),           higherBetter: false },
  { key: 'distanceKm',      label: 'DISTANZ',  fmt: (v) => `${v.toFixed(2)} km`,        higherBetter: true  },
  { key: 'avgWatts',        label: 'Ø WATT',   fmt: (v) => `${v} W`,                    higherBetter: true  },
  { key: 'maxWatts',        label: 'MAX WATT', fmt: (v) => `${v} W`,                    higherBetter: true  },
  { key: 'avgSpeedKmh',     label: 'Ø KM/H',  fmt: (v) => `${v.toFixed(1)} km/h`,      higherBetter: true  },
  { key: 'maxSpeedKmh',     label: 'MAX KM/H', fmt: (v) => `${v.toFixed(1)} km/h`,     higherBetter: true  },
  { key: 'energyKj',        label: 'ENERGIE',  fmt: (v) => `${v} kJ`,                   higherBetter: true  },
];

function fmt(date) {
  return new Date(date).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtShort(date) {
  return new Date(date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

export default function HistoryView({ rides, onDelete }) {
  const [selected, setSelected] = useState([]);

  function toggleSelect(id) {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((s) => s !== id)
        : prev.length < 2
          ? [...prev, id]
          : [prev[1], id],
    );
  }

  const [mapOpen, setMapOpen] = useState(null);

  const compareRides = rides.filter((r) => selected.includes(r.id));
  const comparing = compareRides.length === 2;

  if (rides.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-950 p-8 text-center font-mono">
        <div>
          <p className="text-sm font-black text-zinc-400">KEINE FAHRTEN GESPEICHERT</p>
          <p className="mt-2 text-xs font-bold text-zinc-600">Fahrt starten und am Ende speichern.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-950">
      {comparing && (
        <div className="border-b border-zinc-800 bg-zinc-900 p-3">
          <div className="mb-2 flex items-center justify-between font-mono text-xs font-black">
            <span className="text-zinc-400">VERGLEICH</span>
            <button onClick={() => setSelected([])} className="text-zinc-500">✕ SCHLIESSEN</button>
          </div>
          <table className="w-full font-mono text-xs">
            <thead>
              <tr>
                <th className="pb-1 text-left font-black text-zinc-600" />
                <th className="pb-1 text-right font-black text-zinc-300">{fmtShort(compareRides[0].date)}</th>
                <th className="pb-1 pl-2 text-right font-black text-zinc-300">{fmtShort(compareRides[1].date)}</th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map(({ key, label, fmt: f, higherBetter }) => {
                const a = compareRides[0][key];
                const b = compareRides[1][key];
                const aWins = higherBetter ? a >= b : a <= b;
                return (
                  <tr key={key} className="border-t border-zinc-800">
                    <td className="py-1 pr-2 font-black text-zinc-600">{label}</td>
                    <td className={`py-1 text-right ${aWins ? 'text-lime-300' : 'text-zinc-400'}`}>{f(a)}</td>
                    <td className={`py-1 pl-2 text-right ${!aWins ? 'text-lime-300' : 'text-zinc-400'}`}>{f(b)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!comparing && rides.length >= 2 && (
        <p className="border-b border-zinc-800 px-3 py-2 font-mono text-[10px] font-black text-zinc-600">
          2 FAHRTEN ANTIPPEN ZUM VERGLEICHEN
        </p>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {rides.map((ride) => {
          const isSelected = selected.includes(ride.id);
          return (
            <div
              key={ride.id}
              onClick={() => toggleSelect(ride.id)}
              className={`cursor-pointer rounded border p-3 transition-colors ${
                isSelected ? 'border-lime-400 bg-zinc-800' : 'border-zinc-800 bg-zinc-900 active:bg-zinc-800'
              }`}
            >
              <div className="mb-2 flex items-start justify-between">
                <span className="font-mono text-xs font-black text-zinc-400">{fmt(ride.date)}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(ride.id); }}
                  className="ml-2 font-mono text-xs font-black text-zinc-700 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-3 gap-x-3 gap-y-2 font-mono">
                {[
                  { label: 'ZEIT',     value: formatDuration(ride.durationSeconds) },
                  { label: 'DISTANZ',  value: `${ride.distanceKm.toFixed(2)} km` },
                  { label: 'Ø WATT',   value: `${ride.avgWatts} W` },
                  { label: 'MAX WATT', value: `${ride.maxWatts} W` },
                  { label: 'MAX KM/H', value: `${ride.maxSpeedKmh.toFixed(1)}` },
                  { label: 'ENERGIE',  value: `${ride.energyKj} kJ` },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="text-[10px] font-bold text-zinc-600">{label}</div>
                    <div className="text-xs font-black text-zinc-100">{value}</div>
                  </div>
                ))}
              </div>

              {/* Strecken-Button + Karte */}
              {ride.track?.length >= 2 && (
                <div onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => setMapOpen(mapOpen === ride.id ? null : ride.id)}
                    className="mt-3 w-full rounded border border-zinc-700 py-1.5 font-mono text-[10px] font-black text-zinc-500"
                  >
                    {mapOpen === ride.id ? '▲ STRECKE AUSBLENDEN' : `▼ STRECKE ANZEIGEN (${ride.track.length} Punkte)`}
                  </button>
                  {mapOpen === ride.id && (
                    <div className="mt-2">
                      <Suspense fallback={<div className="flex h-52 items-center justify-center font-mono text-xs text-zinc-600">KARTE LÄDT...</div>}>
                        <RideMap track={ride.track} />
                      </Suspense>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
