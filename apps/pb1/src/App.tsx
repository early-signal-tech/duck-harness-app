// The PB-1 standalone app: a host window around the PB-1 device, with one engine, the
// Parkbench bridge (cli-bridge's pb1-serve). PB-1 has no agent behind it, so it has no
// Settings. Opened in a plain browser instead of the Tauri window (the headless checks),
// there's no host to start an engine, so the panel plays on the fake engine.

import { fakeEngine, Pb1, useBridge, type Pb1Connection, type QueryCatalog } from "@dh/pb1";
import { tauriTransport } from "@dh/ui-kit";
import { invoke } from "@tauri-apps/api/core";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// PB-1's engine, as the host crate names it.
const transport = tauriTransport("pb1");

const fake: Pb1Connection = {
  engine: fakeEngine({ confirm: async (title, message) => window.confirm(`${title}\n\n${message}`) }),
  status: "ready",
  error: null,
  warning: "Not in the app: this is the fake engine, and nothing touches a database.",
};

const useConnection = inTauri ? () => useBridge(transport) : () => fake;

/** QUERY: the host opens Terminal on the catalog (crates/dh-host, pb1.rs). */
const openQuery = inTauri
  ? (catalog: QueryCatalog, secret?: string) => invoke<void>("pb1_query_open", { catalog, secret: secret ?? null })
  : undefined;

export default function App() {
  return <Pb1 connection={useConnection()} onQuery={openQuery} />;
}
