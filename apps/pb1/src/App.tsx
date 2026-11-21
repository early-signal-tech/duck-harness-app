// The PB-1 standalone app: a host window around the PB-1 device. Until it's wired to
// Parkbench, the device runs on the fake engine, which acts like Parkbench without touching
// a database. A reset is confirmed in a native dialog, as the host will do for the real one.

import { fakeEngine, Pb1, type Pb1Connection } from "@dh/pb1";
import { ask } from "@tauri-apps/plugin-dialog";

/** Opened in a browser instead of the Tauri window (the headless checks), there's no native
 *  dialog to ask with. */
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const confirm = async (title: string, message: string) =>
  inTauri ? ask(message, { title, kind: "warning", okLabel: "Reset", cancelLabel: "Cancel" }) : window.confirm(`${title}\n\n${message}`);

const connection: Pb1Connection = { engine: fakeEngine({ confirm }), status: "ready", error: null };

export default function App() {
  return <Pb1 connection={connection} />;
}
