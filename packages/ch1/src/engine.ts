// What CH-1 needs from an engine: DH-1's (the agent server, through Harness) or the fake
// one (fakeEngine.ts). CH-1 has no engine of its own: it plays DH-1's.

import type { Harness } from "@dh/dh1";

export type ChatEngine = Pick<Harness, "conversations" | "conversation" | "run">;
