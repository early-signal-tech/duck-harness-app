import { describe, expect, it } from "vitest";
import type { BatchEvent, DoneEvent, TickEvent } from "../events";
import { advance, startSequence, type Pad } from "../sequencer";
import { DEFAULT_SETTINGS, type Pb1Settings } from "../settings";
import { modeTile, summarize, type SummaryInput } from "../summary";

const blank: Pad[] = Array.from({ length: 16 }, () => ({ mark: null, flush: false }));
const base = (patch: Partial<SummaryInput> = {}): SummaryInput => ({
  settings: DEFAULT_SETTINGS, status: "ready", error: null, powered: true, phase: "idle", seq: null,
  statusLine: "READY — batch · local duckdb · wh.events", table: "wh.events", blankPads: blank, ...patch,
});
const batch = (n: number): BatchEvent => ({
  event: "batch", batch: n, num_batches: 5, rows: 10_000, batch_secs: 0.006, rows_total: n * 10_000, elapsed_secs: n * 0.01, rows_per_sec: 930_481,
});
const tick = (n: number, extra: Partial<TickEvent> = {}): TickEvent => ({
  event: "tick", tick: n, rows: 1, duplicate: false, drift: false, rows_total: n, duplicates: 0, drifts: 0, elapsed_secs: n, rows_per_sec: 1, ...extra,
});
const done: DoneEvent = { event: "done", reason: "complete", steps: 5, rows_total: 50_000, elapsed_secs: 0.054, rows_per_sec: 930_481, duplicates: 0, drifts: 0 };
const with_ = (patch: Partial<Pb1Settings>) => ({ ...DEFAULT_SETTINGS, ...patch });

describe("the rack card's summary", () => {
  it("puts the mode on the tile's label, its tempo and length in the value", () => {
    expect(modeTile(with_({ mode: "BATCH", batchSize: 10_000, length: 5 }))).toEqual({ label: "BATCH", value: "10k × 5" });
    expect(modeTile(with_({ mode: "BATCH", batchSize: 1_000_000, length: 0 }))).toEqual({ label: "BATCH", value: "1M × ∞" });
    expect(modeTile(with_({ mode: "STREAM", tickInterval: 2, length: 10 }))).toEqual({ label: "STREAM", value: "2s · 10 min" });
    expect(modeTile(with_({ mode: "RESET" }))).toEqual({ label: "MODE", value: "RESET" });
  });

  it("is READY with no run yet", () => {
    const s = summarize(base());
    expect(s.display).toEqual({ title: "READY", line: "batch · local duckdb" });
    expect(s.stat).toEqual({ label: "LAST RUN", value: "–" });
    expect([s.busy, s.problem, s.lit]).toEqual([null, null, -1]);
  });

  it("follows a batch run's steps, then shows DONE and rows/s", () => {
    let seq = startSequence(1);
    for (let n = 1; n <= 3; n++) seq = advance(seq, batch(n));
    const playing = summarize(base({ phase: "running", seq, statusLine: "batch 3 / 5 · local duckdb · wh.events" }));
    expect(playing.display).toEqual({ title: "BAR 1 · STEP 3", line: "batch 3 / 5 · local duckdb · wh.events" });
    expect(playing.stat).toEqual({ label: "ROWS", value: "30,000" });
    expect([playing.lit, playing.busy]).toEqual([2, "BATCH: running…"]);

    seq = advance(advance(advance(seq, batch(4)), batch(5)), done);
    const finished = summarize(base({ seq }));
    expect(finished.display).toEqual({ title: "DONE", line: "50,000 rows · 5 batches" });
    expect(finished.stat).toEqual({ label: "LAST RUN", value: "930k rows/s" });
    expect(finished.pads.filter((p) => p.mark).length).toBe(5);
    expect([finished.lit, finished.busy]).toEqual([-1, null]);
  });

  it("shows a stream's duplicates and drift while it plays", () => {
    const seq = advance(advance(startSequence(1), tick(1)), tick(2, { duplicate: true, duplicates: 1, drifts: 1, rows_total: 3 }));
    const s = summarize(base({ settings: with_({ mode: "STREAM" }), phase: "running", seq, statusLine: "tick 2" }));
    expect(s.stat).toEqual({ label: "ROWS·DUP·DRIFT", value: "3 · 1 · 1" });
    expect(s.busy).toBe("STREAM: running…");
  });

  it("says STOPPED for an interrupted run", () => {
    const seq = advance(startSequence(1), { ...done, reason: "interrupted", steps: 1, rows_total: 10_000 });
    expect(summarize(base({ seq })).display).toEqual({ title: "STOPPED", line: "10,000 rows · 1 batch" });
  });

  it("says why when the engine is down", () => {
    const s = summarize(base({ status: "down", error: "no uv" }));
    expect(s.display.title).toBe("OFFLINE");
    expect(s.problem).toBe("The pb1 bridge isn't running: no uv");
  });
});
