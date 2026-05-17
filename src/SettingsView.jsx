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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-950">
      <SubPageHeader title="KALIBRIERUNG" onBack={onBack} />

      <div className="flex flex-1 flex-col items-center justify-start p-6 font-mono">
        {/* Schritt-Indikator */}
        <div className="mb-8 flex gap-3">
          {[0, 1, 2].map((s) => (
            <div
              key={s}
              className={`h-2 w-8 rounded-full transition-colors ${
                s <= step ? 'bg-lime-400' : 'bg-zinc-700'
              }`}
            />
          ))}
        </div>

        {step === 0 && (
          <div className="w-full max-w-sm space-y-5">
            <h2 className="text-center text-sm font-black text-zinc-100">SCHRITT 1 — VORBEREITUNG</h2>
            <div className="space-y-3 rounded border border-zinc-800 bg-zinc-900 p-4 text-xs font-bold leading-6 text-zinc-300">
              <p className="flex gap-3"><span className="text-lime-400">1.</span> Steige vom Fahrrad ab — kein Körpergewicht auf den Pedalen.</p>
              <p className="flex gap-3"><span className="text-lime-400">2.</span> Stelle das Fahrrad sicher ab (Ständer oder Anlehnen).</p>
              <p className="flex gap-3"><span className="text-lime-400">3.</span> Halte die Kurbeln still — am besten waagerecht oder senkrecht.</p>
            </div>
            <button
              onClick={start}
              disabled={!connected}
              className="w-full rounded border border-lime-400 py-3 text-sm font-black text-lime-300 disabled:border-zinc-700 disabled:text-zinc-600"
            >
              {connected ? 'KALIBRIERUNG STARTEN →' : 'PEDAL NICHT VERBUNDEN'}
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="w-full max-w-sm space-y-5 text-center">
            <h2 className="text-sm font-black text-zinc-100">SCHRITT 2 — WIRD KALIBRIERT</h2>
            <div className="flex justify-center py-4">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-700 border-t-lime-400" />
            </div>
            <p className="text-xs font-bold text-zinc-400">Pedal bitte ruhig halten...<br />Warte auf Antwort vom Sensor.</p>
          </div>
        )}

        {step === 2 && (
          <div className="w-full max-w-sm space-y-5 text-center">
            <h2 className="text-sm font-black text-zinc-100">SCHRITT 3 — ERGEBNIS</h2>
            <div className={`flex justify-center text-4xl py-2 ${calibrationState === 'success' ? 'text-lime-400' : 'text-red-400'}`}>
              {calibrationState === 'success' ? '✓' : '✕'}
            </div>
            <p className={`text-sm font-black ${calibrationState === 'success' ? 'text-lime-300' : 'text-red-400'}`}>
              {calibrationState === 'success' ? 'Erfolgreich kalibriert' : 'Kalibrierung fehlgeschlagen'}
            </p>
            <p className="text-xs font-bold text-zinc-500">{calibrationMessage}</p>
            <button
              onClick={onBack}
              className="w-full rounded border border-zinc-700 py-3 text-sm font-black text-zinc-300"
            >
              FERTIG
            </button>
          </div>
        )}
      </div>
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
