import { describe, expect, it } from "vitest";
import type { RunEvent } from "../events";
import { fakeEngine, resetMessage } from "../fakeEngine";
import { DEFAULT_SETTINGS, runFlags } from "../settings";

const quick = (answer = true) => fakeEngine({ confirm: async () => answer, random: () => 0.01, batchPace: () => 0, tickScale: 0 });

describe("the fake engine", () => {
  it("plays a batch run from PB-1's flags, ending with done", async () => {
    const events: RunEvent[] = [];
    const run = quick().run(runFlags({ ...DEFAULT_SETTINGS, length: 5, flush: 2, batchSize: 1000 }), (e) => events.push(e));
    const done = await run.done;
    expect(events.map((e) => e.event)).toEqual(["batch", "flush", "batch", "batch", "flush", "batch", "batch", "done"]);
    expect(done).toMatchObject({ reason: "complete", steps: 5, rows_total: 5000 });
  });

  it("plays a stream with drift before its tick, and a flush at the end", async () => {
    const events: RunEvent[] = [];
    const flags = runFlags({ ...DEFAULT_SETTINGS, mode: "STREAM", tickInterval: 0.5, length: 1, flush: 2, duplicateRate: 0.5, driftRate: 0.5 });
    const done = await quick().run(flags, (e) => events.push(e)).done;
    expect(done).toMatchObject({ reason: "duration", steps: 120 });
    expect(events.slice(0, 2).map((e) => e.event)).toEqual(["drift", "tick"]);
    expect(events[events.length - 2].event).toBe("flush");
    expect(done.duplicates).toBe(120);
  });

  it("stops like Ctrl-C: done, interrupted", async () => {
    const engine = fakeEngine({ confirm: async () => true, batchPace: () => 5 });
    const events: RunEvent[] = [];
    const run = engine.run(runFlags({ ...DEFAULT_SETTINGS, length: 0 }), (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 30));
    await run.stop();
    const done = await run.done;
    expect(done.reason).toBe("interrupted");
    expect(events[events.length - 1]).toBe(done);
  });

  it("asks before a reset, and says no with code cancelled", async () => {
    await expect(quick(false).reset({ "metadata-store": "duckdb" })).rejects.toMatchObject({ code: "cancelled" });
    await expect(quick(true).reset({ "ducklake-secret": "ducklake_prod" })).resolves.toContain("ducklake_prod");
    expect(resetMessage({ "ducklake-secret": "ducklake_prod" })).toContain("Parquet files already written stay");
    expect(resetMessage({ "metadata-store": "duckdb" })).toContain("local duckdb catalog and its data folder");
  });

  it("keeps a new secret's name and type, never its values", async () => {
    const engine = quick();
    const list = await engine.secrets.create({ name: "ducklake_new", secret_type: "ducklake", values: { data_path: "s3://b/p" }, scope: null, replace: false });
    expect(list.find((s) => s.name === "ducklake_new")).toEqual({ name: "ducklake_new", type: "ducklake", provider: "config", scope: [] });
    expect(JSON.stringify(list)).not.toContain("s3://b/p");
  });
});
