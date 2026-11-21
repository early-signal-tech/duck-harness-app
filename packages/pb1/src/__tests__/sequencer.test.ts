import { describe, expect, it } from "vitest";
import type { BatchEvent, RunEvent, TickEvent } from "../events";
import { advance, barOf, padOf, startSequence, type Sequence } from "../sequencer";

const batch = (n: number): BatchEvent => ({
  event: "batch", batch: n, num_batches: 0, rows: 10, batch_secs: 0.1, rows_total: n * 10, elapsed_secs: n, rows_per_sec: 100,
});
const tick = (n: number, extra: Partial<TickEvent> = {}): TickEvent => ({
  event: "tick", tick: n, rows: 1, duplicate: false, drift: false, rows_total: n, duplicates: 0, drifts: 0, elapsed_secs: n, rows_per_sec: 1, ...extra,
});
const play = (seq: Sequence, events: RunEvent[]) => events.reduce(advance, seq);
const marks = (seq: Sequence) => seq.pads.map((p) => (p.mark ?? "-") + (p.flush ? "F" : "")).join(" ");

describe("the sequencer", () => {
  it("steps once per event, wraps to pad 1, and keeps counting", () => {
    let seq = startSequence(1);
    for (let n = 1; n <= 16; n++) seq = advance(seq, batch(n));
    expect(seq.step).toBe(16);
    expect(seq.pads.every((p) => p.mark === "ok")).toBe(true);

    seq = advance(seq, batch(17));
    expect([seq.step, padOf(seq.step), barOf(seq.step)]).toEqual([17, 0, 2]);
    // A new bar clears the pads.
    expect(seq.pads.filter((p) => p.mark).length).toBe(1);
    expect(seq.rows).toBe(170);
  });

  it("marks drift over a duplicate over a plain insert", () => {
    const seq = play(startSequence(1), [tick(1), tick(2, { duplicate: true, duplicates: 1 }), tick(3, { drift: true, drifts: 1, duplicates: 1 })]);
    expect(seq.pads.slice(0, 3).map((p) => p.mark)).toEqual(["ok", "dup", "drift"]);
    expect([seq.drifts, seq.duplicates]).toEqual([1, 1]);
  });

  it("with PRE-SCALE, one step covers several events and shows the worst of them", () => {
    const seq = play(startSequence(10), [
      ...Array.from({ length: 9 }, (_, i) => tick(i + 1)),
      tick(10, { duplicate: true }),
      tick(11),
    ]);
    expect(seq.events).toBe(11);
    expect(seq.step).toBe(2);
    expect(seq.pads.slice(0, 2).map((p) => p.mark)).toEqual(["dup", "ok"]);
  });

  it("outlines the batch a flush came before", () => {
    // Parkbench writes a batch's flush before the batch itself.
    const seq = play(startSequence(1), [batch(1), { event: "flush", batch: 2, secs: 0.1 }, batch(2), batch(3)]);
    expect(marks(seq).split(" ").slice(0, 3)).toEqual(["ok", "okF", "ok"]);
    expect(seq.pendingFlush).toBeNull();
  });

  it("outlines the last step for a stream's flush at the end", () => {
    const seq = play(startSequence(1), [tick(1), tick(2), { event: "flush", rows: 2, secs: 0.1 }]);
    expect(marks(seq).split(" ").slice(0, 2)).toEqual(["ok", "okF"]);
  });

  it("keeps a drift's message, and takes the totals from done", () => {
    const seq = play(startSequence(1), [
      { event: "drift", tick: 1, id: 5, error: "Binder Error: no column\n\nDid you mean" },
      tick(1, { drift: true, drifts: 1 }),
      { event: "done", reason: "interrupted", steps: 1, rows_total: 1, elapsed_secs: 1, rows_per_sec: 1, duplicates: 0, drifts: 1 },
    ]);
    expect(seq.lastDrift).toBe("Binder Error: no column");
    expect(seq.done?.reason).toBe("interrupted");
    expect(seq.last?.event).toBe("done");
  });
});
