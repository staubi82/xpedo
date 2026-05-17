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
  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950">
      <div className="space-y-6 p-4">

        {/* Verbindung */}
        <section>
          <h2 className="mb-3 font-mono text-[10px] font-black tracking-widest text-zinc-500">VERBINDUNG</h2>
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
            <Row>
              <RowLeft label="KALIBRIEREN" sub={calibrationMessage} />
              <button
                onClick={onCalibrate}
                disabled={!connected || calibrationState === 'running' || calibrationState === 'unsupported'}
                className="rounded border border-zinc-700 px-3 py-1.5 font-mono text-xs font-black text-zinc-300 disabled:opacity-40"
              >
                {calibrationState === 'running' ? '...' : '0x2A66'}
              </button>
            </Row>
          </div>
        </section>

        {/* Training */}
        <section>
          <h2 className="mb-3 font-mono text-[10px] font-black tracking-widest text-zinc-500">TRAINING</h2>
          <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-sm font-black text-zinc-100">FTP</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setFtp((w) => Math.max(50, w - 5))} className="h-8 w-8 rounded border border-zinc-700 font-mono text-base font-black text-zinc-300">−</button>
                <span className="w-16 text-center font-mono text-sm font-black text-zinc-100">{ftp} W</span>
                <button onClick={() => setFtp((w) => Math.min(600, w + 5))} className="h-8 w-8 rounded border border-zinc-700 font-mono text-base font-black text-zinc-300">+</button>
              </div>
            </div>
            <p className="font-mono text-[10px] font-bold text-zinc-600">
              Ausdauer ≥ {Math.round(ftp * 0.56)} W · Tempo ≥ {Math.round(ftp * 0.76)} W · Schwelle ≥ {Math.round(ftp * 0.91)} W · VO2 ≥ {Math.round(ftp * 1.06)} W
            </p>
          </div>
        </section>

        {/* GPS & Anzeige */}
        <section>
          <h2 className="mb-3 font-mono text-[10px] font-black tracking-widest text-zinc-500">GPS & ANZEIGE</h2>
          <div className="space-y-2">
            <Toggle label="GPS IMMER AN" sub={gpsMessage} value={gpsAlwaysOn} onChange={() => setGpsAlwaysOn((v) => !v)} />
            <Toggle label="LCD DARKMODE" value={lcdDarkMode} onChange={() => setLcdDarkMode((v) => !v)} />
            <Toggle label="DIAGNOSE" value={showDiagnostics} onChange={() => setShowDiagnostics((v) => !v)} />
          </div>
        </section>

        {/* Diagnose */}
        {showDiagnostics && (
          <section>
            <h2 className="mb-3 font-mono text-[10px] font-black tracking-widest text-zinc-500">DIAGNOSE</h2>
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
