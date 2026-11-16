// The ES-1 standalone app: a host window around the ES-1 device. ES-1 has no agent behind
// it and its panel has fixed colors, so it has no Settings: the panel's own name strip
// holds the engine light.

import { Es1, useEngine } from "@dh/es1";
import { tauriTransport } from "@dh/ui-kit";

// ES-1's engine, the flowctl bridge, as the host crate names it.
const transport = tauriTransport("es1");

export default function App() {
  const engine = useEngine(transport);
  return <Es1 connection={engine} />;
}
