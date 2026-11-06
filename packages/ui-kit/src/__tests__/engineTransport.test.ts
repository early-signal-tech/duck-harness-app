import { beforeEach, describe, expect, it, vi } from "vitest";

// The Tauri side, faked: invoke records its calls; listen keeps handlers per event name.
const calls: [string, unknown][] = [];
const handlers = new Map<string, ((event: { payload: unknown }) => void)[]>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: unknown) => {
    calls.push([command, args]);
    return 7;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    return () => {};
  },
}));

import { tauriTransport } from "../engineTransport";

const emit = (name: string, payload: unknown) => handlers.get(name)?.forEach((h) => h({ payload }));

describe("tauriTransport", () => {
  beforeEach(() => {
    calls.length = 0;
    handlers.clear();
  });

  it("names its engine in every command", async () => {
    const t = tauriTransport("eh1");
    await t.send('{"type":"hello"}');
    expect(await t.generation()).toBe(7);
    await t.restart();
    expect(calls).toEqual([
      ["engine_send", { engine: "eh1", line: '{"type":"hello"}' }],
      ["engine_generation", { engine: "eh1" }],
      ["engine_restart", { engine: "eh1" }],
    ]);
  });

  it("hears only its own engine when two share a host", async () => {
    const dh1: string[] = [];
    const eh1: string[] = [];
    await tauriTransport("dh1").onMessage((line) => dh1.push(line));
    await tauriTransport("eh1").onMessage((line) => eh1.push(line));
    emit("engine-message", { engine: "dh1", line: "from the agent" });
    emit("engine-message", { engine: "eh1", line: "from the grader" });
    expect(dh1).toEqual(["from the agent"]);
    expect(eh1).toEqual(["from the grader"]);
  });

  it("reports only its own engine's exit", async () => {
    const exits: number[] = [];
    await tauriTransport("dh1").onExit((generation) => exits.push(generation));
    emit("engine-exit", { engine: "eh1", generation: 3 });
    emit("engine-exit", { engine: "dh1", generation: 2 });
    expect(exits).toEqual([2]);
  });
});
