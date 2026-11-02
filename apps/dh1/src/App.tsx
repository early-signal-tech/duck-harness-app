// The DH-1 standalone app: a host window around the DH-1 device.

import { Dh1, useEngine } from "@dh/dh1";
import { HostBar, useAppearance } from "@dh/ui-kit";

export default function App() {
  const [appearance, setAppearance] = useAppearance();
  const engine = useEngine();
  return (
    <div className="host">
      <HostBar
        name="DH-1"
        tagline="DUCK HARNESS · SQL ANALYTICS AGENT"
        appearance={appearance}
        onAppearance={setAppearance}
        engine={{ status: engine.status, error: engine.error }}
      />
      <Dh1 engine={engine} />
    </div>
  );
}
