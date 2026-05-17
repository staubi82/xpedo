import { useEffect, useState } from 'react';

export default function SettingsView({
  ftp, setFtp,
  gpsAlwaysOn, setGpsAlwaysOn,
  lcdDarkMode, setLcdDarkMode,
  showDiagnostics, setShowDiagnostics,
  connected, deviceName, connectionState,
  calibrationState, calibrationMessage,
  gpsState, gpsMessage,
  diagnostics, metrics,
  onConnect, onCalibrate,
}) {
  const [subPage, setSubPage] = useState(null); // null | 'ftp' | 'calibration'

  if (subPage === 'ftp') {
    return <FtpPage ftp={ftp} setFtp={setFtp} onBack={() => setSubPage(null)} />;
  }

  if (subPage === 'calibration') {
    return (
      <CalibrationWizard
        connected={connected}
        calibrationState={calibrationState}
        calibrationMessage={calibrationMessage}
        onCalibrate={onCalibrate}
        onBack={() => setSubPage(null)}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950">
      <div className="space-y-6 p-4">

        {/* Verbindung */}
        <section>
          <SectionHeader>VERBINDUNG</SectionHeader>
          <div className="space-y-2">
            <IosBluetoothHint />
            <Row>
              <RowLeft
                label={connected ? (deviceName || 'PEDAL') : 'PEDAL VERBINDEN'}
                sub={connected ? 'Bluetooth verbunden' : 'Kein Pedal verbunden'}
              />
              <button
                onClick={onConnect}
                disabled={connectionState === 'scanning' || connectionState === 'reconnecting'}
                className="rounded border border-zinc-700 px-3 py-1.5 font-mono text-xs font-black text-zinc-300 disabled:opacity-40"
              >
                {connectionState === 'scanning' || connectionState === 'reconnecting' ? '...' : connected ? 'NEU' : 'VERBINDEN'}
              </button>
            </Row>
            <NavRow
              label="KALIBRIEREN"
              sub={calibrationMessage}
              badge={calibrationState === 'success' ? '✓' : calibrationState === 'error' ? '!' : '›'}
              disabled={!connected || calibrationState === 'unsupported'}
              onClick={() => setSubPage('calibration')}
            />
          </div>
        </section>

        {/* Training */}
        <section>
          <SectionHeader>TRAINING</SectionHeader>
          <NavRow
            label="FTP"
            sub={`${ftp} W · Schwelle ≥ ${Math.round(ftp * 0.91)} W · VO2 ≥ ${Math.round(ftp * 1.06)} W`}
            badge="›"
            onClick={() => setSubPage('ftp')}
          />
        </section>

        {/* GPS & Anzeige */}
        <section>
          <SectionHeader>GPS & ANZEIGE</SectionHeader>
          <div className="space-y-2">
            <Toggle label="GPS IMMER AN" sub={gpsMessage} value={gpsAlwaysOn} onChange={() => setGpsAlwaysOn((v) => !v)} />
            <Toggle label="LCD DARKMODE" value={lcdDarkMode} onChange={() => setLcdDarkMode((v) => !v)} />
            <Toggle label="DIAGNOSE" value={showDiagnostics} onChange={() => setShowDiagnostics((v) => !v)} />
          </div>
        </section>

        {showDiagnostics && (
          <section>
            <SectionHeader>DIAGNOSE</SectionHeader>
            <div className="rounded border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs font-bold leading-5 text-zinc-400">
              <p>FLAGS {metrics.flagsHex} · {diagnostics.byteLength ? `${diagnostics.byteLength} BYTES` : 'WARTET'}</p>
              <p className="mt-1 break-all">{diagnostics.rawHex || '—'}</p>
              <p className="mt-1">FEATURE: {diagnostics.featureHex}</p>
              <p>SENSOR: {diagnostics.sensorLocation}</p>
              <p className="break-all">GATT: {diagnostics.characteristics.map((c) => c.uuid).join(' ') || '—'}</p>
            </div>
          </section>
        )}

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full rounded border border-zinc-800 py-2.5 font-mono text-xs font-black text-zinc-600"
        >
          APP AKTUALISIEREN
        </button>
      </div>
    </div>
  );
}

// ─── FTP Sub-Page ─────────────────────────────────────────────────────────────
function FtpPage({ ftp, setFtp, onBack }) {
  const [input, setInput] = useState(String(ftp));

  function handleInputChange(e) {
    setInput(e.target.value);
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v) && v >= 50 && v <= 600) setFtp(v);
  }

  function nudge(delta) {
    setFtp((v) => {
      const next = Math.min(600, Math.max(50, v + delta));
      setInput(String(next));
      return next;
    });
  }

  const zones = [
    { name: 'Erholung',  pctMin: 0,    pctMax: 0.55, color: 'bg-blue-400'     },
    { name: 'Ausdauer',  pctMin: 0.56, pctMax: 0.75, color: 'bg-emerald-400'  },
    { name: 'Tempo',     pctMin: 0.76, pctMax: 0.90, color: 'bg-cyan-300'     },
    { name: 'Schwelle',  pctMin: 0.91, pctMax: 1.05, color: 'bg-amber-300'    },
    { name: 'VO2 Max',   pctMin: 1.06, pctMax: 1.20, color: 'bg-fuchsia-400'  },
    { name: 'Sprint',    pctMin: 1.21, pctMax: null,  color: 'bg-rose-400'    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-950">
      <SubPageHeader title="FTP" onBack={onBack} />

      <div className="flex-1 space-y-6 overflow-y-auto p-4">

        <section>
          <SectionHeader>WAS IST FTP?</SectionHeader>
          <p className="font-mono text-xs font-bold leading-5 text-zinc-400">
            Functional Threshold Power ist die maximale Durchschnittsleistung in Watt,
            die du über ~60 Minuten aufrechterhalten kannst. Alle Trainingszonen werden
            relativ zu deinem FTP berechnet — so stimmen die Zonen für jeden Fahrer,
            unabhängig vom Leistungsniveau.
          </p>
        </section>

        <section>
          <SectionHeader>FTP ERMITTELN</SectionHeader>
          <div className="space-y-2 font-mono text-xs font-bold text-zinc-400">
            <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
              <p className="font-black text-zinc-200">20-Minuten-Test</p>
              <p className="mt-1 leading-5">5 Min. Aufwärmen → 20 Min. Vollgas → Ergebnis × 0,95 = FTP</p>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
              <p className="font-black text-zinc-200">Ramp-Test</p>
              <p className="mt-1 leading-5">Leistung jede Minute um ~20 W steigern bis zum Abbruch → letzter vollendeter Schritt × 0,75 = FTP</p>
            </div>
          </div>
        </section>

        <section>
          <SectionHeader>DEIN FTP</SectionHeader>
          <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-4 flex items-center justify-center gap-2">
              <button onClick={() => nudge(-10)} className="h-9 w-12 rounded border border-zinc-700 font-mono text-sm font-black text-zinc-300">−10</button>
              <button onClick={() => nudge(-1)}  className="h-9 w-9  rounded border border-zinc-700 font-mono text-sm font-black text-zinc-300">−1</button>
              <input
                type="number"
                min="50"
                max="600"
                value={input}
                onChange={handleInputChange}
                onBlur={() => setInput(String(ftp))}
                className="h-9 w-20 rounded border border-zinc-600 bg-zinc-800 text-center font-mono text-base font-black text-zinc-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="font-mono text-sm font-black text-zinc-500">W</span>
              <button onClick={() => nudge(1)}  className="h-9 w-9  rounded border border-zinc-700 font-mono text-sm font-black text-zinc-300">+1</button>
              <button onClick={() => nudge(10)} className="h-9 w-12 rounded border border-zinc-700 font-mono text-sm font-black text-zinc-300">+10</button>
            </div>
          </div>
        </section>

        <section>
          <SectionHeader>DEINE ZONEN</SectionHeader>
          <div className="space-y-1.5">
            {zones.map((z) => {
              const wMin = Math.round(ftp * z.pctMin);
              const wMax = z.pctMax ? Math.round(ftp * z.pctMax) : null;
              const barWidth = z.pctMax ? Math.min(100, z.pctMax * 80) : 100;
              return (
                <div key={z.name} className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
                  <div className="mb-1.5 flex items-center justify-between font-mono text-xs">
                    <span className="font-black text-zinc-200">{z.name}</span>
                    <span className="font-bold text-zinc-500">
                      {wMax ? `${wMin} – ${wMax} W` : `≥ ${wMin} W`}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div className={`h-full rounded-full ${z.color}`} style={{ width: `${barWidth}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

      </div>
    </div>
  );
}

// ─── Calibration Wizard ───────────────────────────────────────────────────────
function CalibrationWizard({ connected, calibrationState, calibrationMessage, onCalibrate, onBack }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step === 1 && (calibrationState === 'success' || calibrationState === 'error')) {
      setStep(2);
    }
  }, [calibrationState, step]);

  function start() {
    setStep(1);
    onCalibrate();
  }

  const offsetMatch = calibrationMessage?.match(/Offset\s+(-?\d+)/);
  const offsetValue = offsetMatch ? offsetMatch[1] : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <span className="font-mono text-sm font-black tracking-widest text-zinc-200">Kalibrierung</span>
        <button onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 font-mono text-sm text-zinc-400">✕</button>
      </div>

      <div className="flex flex-1 flex-col px-6 pb-6 pt-5 font-mono">

        {/* Vorbereitung (step 0 & 1) */}
        {step <= 1 && (
          <>
            <h2 className="mb-1 text-center text-sm font-black text-zinc-100">Vorbereitung</h2>
            <div className="mb-5 space-y-1 text-center text-xs font-bold text-zinc-400">
              <p>• Schuhe ausgeklickt — nichts berührt die Pedale.</p>
              <p>• Fahrrad stabil halten, Bewegungen minimieren.</p>
            </div>

            {/* Fahrrad-Illustration */}
            <div className="relative mx-auto mb-6 flex h-52 w-52 items-center justify-center rounded-full bg-zinc-800">
              <CranksetSvg dimmed={step === 1} />
              {step === 1 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-full bg-zinc-900/75">
                  <div className="h-9 w-9 animate-spin rounded-full border-4 border-zinc-700 border-t-amber-400" />
                  <span className="text-xs font-black text-amber-300">Kalibriert...</span>
                </div>
              )}
            </div>

            <div className="mt-auto">
              <button
                onClick={start}
                disabled={!connected || step === 1}
                className="w-full rounded-full border-2 border-zinc-500 py-4 text-sm font-black text-zinc-100 transition-opacity disabled:opacity-40"
              >
                {step === 1 ? 'Kalibriert...' : connected ? 'Kalibrieren' : 'Pedal nicht verbunden'}
              </button>
            </div>
          </>
        )}

        {/* Ergebnis (step 2) */}
        {step === 2 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <div className={`flex h-32 w-32 items-center justify-center rounded-full border-4 ${
              calibrationState === 'success' ? 'border-zinc-400' : 'border-red-500'
            }`}>
              {calibrationState === 'success' ? (
                <svg viewBox="0 0 48 48" className="h-16 w-16 stroke-zinc-300" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="8,24 20,36 40,14" />
                </svg>
              ) : (
                <svg viewBox="0 0 48 48" className="h-14 w-14 stroke-red-400" fill="none" strokeWidth="4" strokeLinecap="round">
                  <line x1="12" y1="12" x2="36" y2="36" />
                  <line x1="36" y1="12" x2="12" y2="36" />
                </svg>
              )}
            </div>

            <p className="text-center text-sm font-black text-zinc-100">
              {calibrationState === 'success' ? 'Kalibrierung abgeschlossen.' : 'Kalibrierung fehlgeschlagen.'}
            </p>

            {offsetValue !== null && (
              <p className="text-sm text-zinc-400">
                Ergebnis:{' '}
                <span className="font-black text-lime-400">{offsetValue} Offset</span>
              </p>
            )}

            <div className="mt-auto w-full">
              <button
                onClick={onBack}
                className="w-full rounded-full border-2 border-zinc-500 py-4 text-sm font-black text-zinc-100"
              >
                Fertig
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CranksetSvg({ dimmed }) {
  const c      = dimmed ? '#4b5563' : '#71717a';
  const bright = dimmed ? '#374151' : '#a1a1aa';
  const bg     = dimmed ? '#1f2937' : '#27272a';

  return (
    <svg viewBox="0 0 160 160" width="140" height="140" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer chain ring */}
      <circle cx="80" cy="80" r="50" stroke={c} strokeWidth="5" />
      {/* Inner ring */}
      <circle cx="80" cy="80" r="32" stroke={c} strokeWidth="3" />
      {/* Spider arms (5-bolt) */}
      {[90, 162, 234, 306, 18].map((deg) => {
        const r = (deg * Math.PI) / 180;
        return <line key={deg} x1="80" y1="80" x2={80 + Math.cos(r) * 30} y2={80 + Math.sin(r) * 30} stroke={c} strokeWidth="3" strokeLinecap="round" />;
      })}
      {/* Chain teeth */}
      {Array.from({ length: 18 }).map((_, i) => {
        const a = (i / 18) * Math.PI * 2;
        return <circle key={i} cx={80 + Math.cos(a) * 52} cy={80 + Math.sin(a) * 52} r="2.2" fill={c} />;
      })}
      {/* Center BB */}
      <circle cx="80" cy="80" r="9" fill={c} />
      <circle cx="80" cy="80" r="4" fill={bg} />

      {/* Crank arm — 12 o'clock (up) */}
      <rect x="74" y="22" width="12" height="50" rx="6" fill={c} />
      {/* Pedal oben — horizontal */}
      <rect x="50" y="14" width="60" height="15" rx="7" fill={c} />
      {/* Pedal-pin links oben */}
      <rect x="51" y="11" width="4" height="21" rx="2" fill={bright} />
      <rect x="59" y="11" width="4" height="21" rx="2" fill={bright} />
      <rect x="97" y="11" width="4" height="21" rx="2" fill={bright} />
      <rect x="105" y="11" width="4" height="21" rx="2" fill={bright} />

      {/* Crank arm — 6 o'clock (down, highlighted) */}
      <rect x="74" y="88" width="12" height="52" rx="6" fill={bright} />
      {/* Pedal unten — horizontal */}
      <rect x="50" y="131" width="60" height="15" rx="7" fill={bright} />
      {/* Pedal-pins unten */}
      <rect x="51" y="128" width="4" height="21" rx="2" fill={dimmed ? bright : '#d4d4d8'} />
      <rect x="59" y="128" width="4" height="21" rx="2" fill={dimmed ? bright : '#d4d4d8'} />
      <rect x="97" y="128" width="4" height="21" rx="2" fill={dimmed ? bright : '#d4d4d8'} />
      <rect x="105" y="128" width="4" height="21" rx="2" fill={dimmed ? bright : '#d4d4d8'} />
    </svg>
  );
}

// ─── iOS Bluetooth Hint ───────────────────────────────────────────────────────
function IosBluetoothHint() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (!isIos || navigator.bluetooth) return null;

  return (
    <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 font-mono text-xs font-bold leading-5">
      <p className="font-black text-amber-300">⚠ iOS erkannt — Safari & Chrome unterstützen kein Web Bluetooth</p>
      <p className="mt-2 text-zinc-300">
        Bitte <span className="font-black text-white">Bluefy</span> aus dem App Store installieren.
        Bluefy ist ein Browser mit Web Bluetooth Unterstützung und funktioniert mit dieser App.
      </p>
      <a
        href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex items-center justify-between rounded border border-amber-500/50 bg-amber-500/20 px-3 py-2 text-amber-200"
      >
        <span>Bluefy – Web BLE Browser</span>
        <span>App Store →</span>
      </a>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────
function SubPageHeader({ title, onBack }) {
  return (
    <div className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-3 py-3">
      <button onClick={onBack} className="font-mono text-xs font-black text-zinc-400">← ZURÜCK</button>
      <span className="font-mono text-xs font-black tracking-widest text-zinc-300">{title}</span>
    </div>
  );
}

function SectionHeader({ children }) {
  return <h2 className="mb-3 font-mono text-[10px] font-black tracking-widest text-zinc-500">{children}</h2>;
}

function Row({ children }) {
  return (
    <div className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900 px-3 py-3">
      {children}
    </div>
  );
}

function RowLeft({ label, sub }) {
  return (
    <div>
      <div className="font-mono text-sm font-black text-zinc-100">{label}</div>
      {sub && <div className="font-mono text-xs font-bold text-zinc-500">{sub}</div>}
    </div>
  );
}

function NavRow({ label, sub, badge, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between rounded border border-zinc-800 bg-zinc-900 px-3 py-3 disabled:opacity-40"
    >
      <RowLeft label={label} sub={sub} />
      <span className="font-mono text-sm font-black text-zinc-500">{badge}</span>
    </button>
  );
}

function Toggle({ label, sub, value, onChange }) {
  return (
    <div onClick={onChange} className="flex cursor-pointer items-center justify-between rounded border border-zinc-800 bg-zinc-900 px-3 py-3">
      <div>
        <div className="font-mono text-sm font-black text-zinc-100">{label}</div>
        {sub && <div className="font-mono text-xs font-bold text-zinc-500">{sub}</div>}
      </div>
      <div className={`flex h-6 w-11 items-center rounded-full border border-zinc-700 p-0.5 transition-colors ${value ? 'justify-end bg-lime-400' : 'justify-start bg-zinc-800'}`}>
        <div className="h-[18px] w-[18px] rounded-full bg-zinc-900 shadow" />
      </div>
    </div>
  );
}
