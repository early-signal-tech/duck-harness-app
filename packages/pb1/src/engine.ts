// What PB-1 needs from its engine: the real one is cli-bridge's pb1-serve (bridge.ts), and
// the fake (fakeEngine.ts) stands in for it where there's no host, such as a browser.
// The panel hands over Parkbench's flags (settings.ts) and gets Parkbench's events back.

import type { SecretsControls } from "@dh/ui-kit";
import type { DoneEvent, RunEvent } from "./events";
import type { Flags } from "./settings";

export interface Running {
  /** The run's `done` event. Rejects if the run fails. */
  done: Promise<DoneEvent>;
  /** Interrupt it, as Ctrl-C would: it still ends with `done`, reason "interrupted". */
  stop: () => Promise<void>;
}

export interface Pb1Engine {
  /** `parkbench setup`. Resolves with what to show on the display. */
  setup(flags: Flags): Promise<string>;
  /** `parkbench reset`. The host asks the person first; it rejects with code "cancelled" if they
   *  say no, so the panel doesn't ask again. */
  reset(flags: Flags): Promise<string>;
  /** `parkbench run`, with an event for each line it writes. */
  run(flags: Flags, onEvent: (event: RunEvent) => void): Running;
  /** DuckDB's persistent secrets. A DuckLake secret can be the catalog. Values go to the
   *  engine in one message and never come back. */
  secrets: SecretsControls;
}

export interface Pb1Connection {
  engine: Pb1Engine | null;
  status: "connecting" | "ready" | "down";
  error: string | null;
  /** Something to know that doesn't stop it, such as an untested Parkbench. */
  warning?: string | null;
}

export class Pb1Error extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}
