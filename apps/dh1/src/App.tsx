// The DH-1 standalone app: a host window around the DH-1 device.

import { Dh1, useEngine } from "@dh/dh1";
import { HostBar, useAppearance } from "@dh/ui-kit";
import { useState } from "react";
import { SettingsMenu } from "./Settings";

export default function App() {
  const [appearance, setAppearance] = useAppearance();
  const engine = useEngine();
  // A slot in the header bar for the device's own controls (DH-1's preset bar).
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  return (
    <div className="host">
      <HostBar
        name="DH-1"
        tagline="SQL ANALYTICS AGENT"
        engine={{ status: engine.status, error: engine.error }}
        settings={<SettingsMenu engine={engine} appearance={appearance} onAppearance={setAppearance} />}
      >
        <div className="host-slot" ref={setToolbar} />
      </HostBar>
      <Dh1 engine={engine} toolbar={toolbar} />
    </div>
  );
}
