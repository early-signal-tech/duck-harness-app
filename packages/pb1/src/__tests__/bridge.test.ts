import type { EngineTransport } from "@dh/ui-kit";
import { beforeEach, describe, expect, it } from "vitest";
import { ARGS, argsFor, Bridge } from "../bridge";
import type { RunEvent } from "../events";
import {
  connectionFlags, DEFAULT_SETTINGS, DISTRIBUTION, flagsFor, LENGTH, LOCAL_DUCKDB, LOCAL_POSTGRES, MODES, PARTITION, runFlags,
  SCHEMA, type Pb1Settings,
} from "../settings";

class FakeTransport implements EngineTransport {
  readonly engine = "pb1";
  sent: Record<string, unknown>[] = [];
  confirmed: Record<string, unknown>[] = [];
  answer: "ok" | "cancel" = "ok";
  private message: (line: string) => void = () => {};
  private exit: (generation: number) => void = () => {};
  async send(line: string) { this.sent.push(JSON.parse(line)); }
  async sendConfirmed(line: string) {
    this.confirmed.push(JSON.parse(line));
    if (this.answer === "cancel") throw "cancelled";
    this.sent.push(JSON.parse(line));
  }
  async generation() { return 1; }
  async restart() { return 2; }
  async onMessage(handler: (line: string) => void) { this.message = handler; return () => {}; }
  async onExit(handler: (generation: number) => void) { this.exit = handler; return () => {}; }
  reply(message: Record<string, unknown>) { this.message(JSON.stringify(message)); }
  exited(generation: number) { this.exit(generation); }
  async last() {
    await Promise.resolve();
    await Promise.resolve();
    return this.sent[this.sent.length - 1];
  }
}

const done = { event: "done", reason: "complete", steps: 2, rows_total: 20, elapsed_secs: 1, rows_per_sec: 20, duplicates: 0, drifts: 0 };

describe("argsFor", () => {
  it("turns Parkbench's flags into the bridge's arguments, every value a string", () => {
    expect(argsFor("run", runFlags({ ...DEFAULT_SETTINGS, migrate: true, schema: "rich_ml", mlLabels: true, conversion: 0.25 }))).toMatchObject({
      metadata_store: "duckdb", migrate: "true", run_mode: "batch", mode: "rich_ml", ml_labels: "true", conversion_rate: "0.25", batch_size: "100000",
    });
  });

  it("refuses a flag the bridge doesn't take, by name", () => {
    expect(() => argsFor("reset", { "data-sink": "postgres" })).toThrow("--data-sink");
  });

  // Every setting the panel can reach maps onto the bridge's table, so a control can't send
  // something the engine refuses.
  it("covers every combination of mode, catalog, schema, sink and the switches", () => {
    const sweep: Pb1Settings[] = [];
    for (const mode of MODES) for (const catalog of [LOCAL_DUCKDB, LOCAL_POSTGRES, "ducklake_prod"]) for (const schema of SCHEMA)
      for (const sink of ["ducklake", "postgres"] as const) for (const on of [false, true])
        for (const distribution of DISTRIBUTION) for (const partition of PARTITION) for (const length of [LENGTH[0], 0 as const])
          sweep.push({ ...DEFAULT_SETTINGS, mode, catalog, schema, sink, distribution, partition, length, migrate: on, mlLabels: on, payload: on ? "variant" : "json", fine: on ? 25 : 0 });
    let checked = 0;
    for (const s of sweep) {
      const verb = s.mode === "SETUP" ? "setup" : s.mode === "RESET" ? "reset" : "run";
      expect(() => argsFor(verb, flagsFor(s))).not.toThrow();
      expect(() => argsFor("reset", connectionFlags({ ...s, mode: "RESET" }))).not.toThrow();
      checked++;
    }
    expect(checked).toBeGreaterThan(2000);
    expect(ARGS.run).toContain("tick_interval");
  });
});

describe("the bridge", () => {
  let transport: FakeTransport;
  let bridge: Bridge;
  beforeEach(async () => {
    transport = new FakeTransport();
    bridge = await Bridge.connect(transport);
  });

  it("checks hello's protocol and device", async () => {
    const good = bridge.hello();
    transport.reply({ id: (await transport.last()).id, type: "hello", protocol: 1, device: "pb1", tool: { status: "untested" } });
    await expect(good).resolves.toMatchObject({ device: "pb1" });
    const wrong = bridge.hello();
    transport.reply({ id: (await transport.last()).id, type: "hello", protocol: 1, device: "es1" });
    await expect(wrong).rejects.toThrow("not PB-1");
  });

  it("streams a run's events and resolves with done", async () => {
    const events: RunEvent[] = [];
    const run = bridge.run(runFlags(DEFAULT_SETTINGS), (e) => events.push(e));
    const sent = await transport.last();
    expect(sent).toMatchObject({ type: "run", args: { run_mode: "batch", metadata_store: "duckdb" } });
    const id = sent.id;
    transport.reply({ id, type: "accepted" });
    transport.reply({ id, type: "event", event: "line", line: { event: "batch", batch: 1 } });
    transport.reply({ id, type: "event", event: "line", text: "not json" });
    transport.reply({ id, type: "event", event: "line", line: done });
    transport.reply({ id, type: "result", result: { ok: true, lines: 2, stopped: false } });
    await expect(run.done).resolves.toEqual(done);
    expect(events.map((e) => e.event)).toEqual(["batch", "done"]);
  });

  it("stops a run by its id, and a failed run says Parkbench's first line", async () => {
    const run = bridge.run(runFlags(DEFAULT_SETTINGS), () => {});
    const id = (await transport.last()).id;
    void run.stop();
    expect(await transport.last()).toMatchObject({ type: "stop", request: id });
    transport.reply({ id, type: "result", result: { ok: false, error: "Error: batch 1 insert: Binder Error\nUsage:\n  parkbench run", code: "tool_error" } });
    await expect(run.done).rejects.toThrow(/^batch 1 insert: Binder Error$/);
  });

  it("confirms a reset with the host, and a cancel sends nothing", async () => {
    transport.answer = "cancel";
    await expect(bridge.reset({ "metadata-store": "duckdb" })).rejects.toMatchObject({ code: "cancelled" });
    expect(transport.sent).toEqual([]);
    expect(transport.confirmed[0]).toMatchObject({ type: "reset", args: { metadata_store: "duckdb" } });
  });

  it("sends a secret's values once, as input, through the host's confirmation, then lists", async () => {
    const created = bridge.secrets.create({ name: "s3_main", secret_type: "s3", values: { key_id: "AKIA", secret: "shh" }, scope: "s3://b", replace: false });
    const sent = await transport.last();
    expect(transport.confirmed).toHaveLength(1);
    expect(sent).toMatchObject({ type: "secrets_create", args: { type: "s3", name: "s3_main" }, input: { values: { key_id: "AKIA", secret: "shh", scope: "s3://b" } } });
    expect(JSON.stringify(sent.args)).not.toContain("shh");
    transport.reply({ id: sent.id, type: "result", result: { ok: true } });
    const list = await transport.last();
    expect(list).toMatchObject({ type: "secrets_list" });
    transport.reply({ id: list.id, type: "result", result: { ok: true, rows: [{ name: "s3_main", type: "s3", provider: "config", scope: ["s3://b"] }] } });
    await expect(created).resolves.toEqual([{ name: "s3_main", type: "s3", provider: "config", scope: ["s3://b"] }]);
  });

  it("fails what's waiting when the engine exits", async () => {
    const waiting = bridge.secrets.list();
    await transport.last();
    transport.exited(1);
    await expect(waiting).rejects.toThrow("bridge stopped");
    await expect(bridge.setup({})).rejects.toThrow("not running");
  });
});
