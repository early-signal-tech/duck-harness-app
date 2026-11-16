// The EH-1 standalone app: a host window around the EH-1 device. Settings are the same as
// DH-1's (the Keychain key, the traces file, appearance); the traces server belongs to
// DH-1's agent, so it isn't managed from here.

import { Eh1, useEngine } from "@dh/eh1";
import { HostBar, SettingsMenu, tauriTransport, useAppearance } from "@dh/ui-kit";
import { useState } from "react";

// EH-1's engine, the grader, as the host crate names it.
const transport = tauriTransport("eh1");

export default function App() {
  const [appearance, setAppearance] = useAppearance();
  const engine = useEngine(transport);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  return (
    <div className="host">
      <HostBar
        name="EH-1"
        tagline="ANSWER EVALUATOR"
        engine={{ status: engine.status, error: engine.error }}
        settings={<SettingsMenu engine={engine} appearance={appearance} onAppearance={setAppearance} />}
      >
        <div className="host-slot" ref={setToolbar} />
      </HostBar>
      <Eh1 engine={engine} toolbar={toolbar} />
    </div>
  );
}
