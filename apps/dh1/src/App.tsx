// The DH-1 standalone app: a host window around the DH-1 device.

import { Dh1, useEngine } from "@dh/dh1";
import { HostBar, SettingsMenu, tauriTransport, useAppearance, type TracesControls } from "@dh/ui-kit";
import { useMemo, useState } from "react";

// DH-1's engine, the agent server, as the host crate names it.
const transport = tauriTransport("dh1");

export default function App() {
  const [appearance, setAppearance] = useAppearance();
  const engine = useEngine(transport);
  // A slot in the header bar for the device's own controls (DH-1's preset bar).
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  // DH-1's agent runs the traces server, so its Settings can show and manage it.
  const harness = engine.harness;
  const traces = useMemo<TracesControls | undefined>(() => harness
    ? { info: () => harness.traces(), stop: () => harness.tracesStop(), reset: () => harness.tracesReset() }
    : undefined, [harness]);
  return (
    <div className="host">
      <HostBar
        name="DH-1"
        tagline="SQL ANALYTICS AGENT"
        engine={{ status: engine.status, error: engine.error }}
        settings={<SettingsMenu engine={engine} traces={traces} appearance={appearance} onAppearance={setAppearance} />}
      >
        <div className="host-slot" ref={setToolbar} />
      </HostBar>
      <Dh1 engine={engine} toolbar={toolbar} />
    </div>
  );
}
