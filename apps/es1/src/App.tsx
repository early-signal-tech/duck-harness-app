// The ES-1 standalone app: a host window around the ES-1 device. ES-1 has no agent behind
// it and its panel has fixed colors, so Settings is only how the engine was started. The panel has its own
// name strip, which holds Settings and the engine light, so there's no HostBar here.

import { Es1, useEngine } from "@dh/es1";
import { SettingsMenu, tauriTransport, useAppearance } from "@dh/ui-kit";
import { useMemo } from "react";

// ES-1's engine, the flowctl bridge, as the host crate names it.
const transport = tauriTransport("es1");

export default function App() {
  const [appearance, setAppearance] = useAppearance();
  const engine = useEngine(transport);
  // Settings shows the engine's version from its hello.
  const settingsEngine = useMemo(() => ({ ...engine, versions: { es1: engine.hello?.version } }), [engine]);
  return (
    <Es1
      connection={engine}
      settings={<SettingsMenu engine={settingsEngine} appearance={appearance} onAppearance={setAppearance} engineOnly />}
    />
  );
}
