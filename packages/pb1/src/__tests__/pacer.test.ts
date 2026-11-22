import { describe, expect, it } from "vitest";
import type { BatchEvent, DoneEvent, FlushEvent, RunEvent } from "../events";
import { createPacer, MAX_WAITING, STEP_MS, type Timers } from "../pacer";

const batch = (n: number): BatchEvent => ({
  event: "batch", batch: n, num_batches: 5, rows: 10, batch_secs: 0.006, rows_total: n * 10, elapsed_secs: n * 0.006, rows_per_sec: 100,
});
const flush = (n: number): FlushEvent => ({ event: "flush", batch: n, secs: 0.01 });
const done = (steps: number): DoneEvent => ({
  event: "done", reason: "complete", steps, rows_total: steps * 10, elapsed_secs: 0.06, rows_per_sec: 100, duplicates: 0, drifts: 0,
});

/** A clock that only moves when the test says so. */
function clock() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const t: Timers = {
    now: () => now,
    set: (fn, ms) => { const id = ++ids; timers.push({ at: now + ms, fn, id }); return id; },
    clear: (id) => { timers = timers.filter((x) => x.id !== id); },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      now = next.at;
      next.fn();
    }
    now = end;
  };
  return { t, advance };
}

const label = (e: RunEvent) => (e.event === "batch" ? `b${e.batch}` : e.event === "flush" ? `f${e.batch}` : e.event);

describe("the pacer", () => {
  it("lights one pad every half second when batches arrive at once", () => {
    const { t, advance } = clock();
    const seen: string[] = [];
    const pacer = createPacer((e) => seen.push(label(e)), { prescale: 1, timers: t });
    for (let n = 1; n <= 5; n++) pacer.push(batch(n));
    pacer.push(done(5));

    expect(seen).toEqual(["b1"]);
    advance(STEP_MS - 1);
    expect(seen).toEqual(["b1"]);
    advance(1);
    expect(seen).toEqual(["b1", "b2"]);
    advance(3 * STEP_MS);
    expect(seen).toEqual(["b1", "b2", "b3", "b4", "b5"]);
    // DONE waits one step, so the last pad's lamp shows.
    advance(STEP_MS);
    expect(seen).toEqual(["b1", "b2", "b3", "b4", "b5", "done"]);
  });

  it("keeps a flush with its batch", () => {
    const { t, advance } = clock();
    const seen: string[] = [];
    const pacer = createPacer((e) => seen.push(label(e)), { prescale: 1, timers: t });
    [batch(1), flush(1), batch(2), flush(2)].forEach(pacer.push);
    expect(seen).toEqual(["b1", "f1"]);
    advance(STEP_MS);
    expect(seen).toEqual(["b1", "f1", "b2", "f2"]);
  });

  it("waits per pad, not per batch, under PRE-SCALE", () => {
    const { t } = clock();
    const seen: string[] = [];
    const pacer = createPacer((e) => seen.push(label(e)), { prescale: 10, timers: t });
    for (let n = 1; n <= 5; n++) pacer.push(batch(n));
    // All five batches are one pad, so they show together.
    expect(seen).toEqual(["b1", "b2", "b3", "b4", "b5"]);
  });

  it("jumps ahead so no more than a bar is left to play", () => {
    const { t, advance } = clock();
    const seen: number[] = [];
    const pacer = createPacer((e) => { if (e.event === "batch") seen.push(e.batch); }, { prescale: 1, timers: t });
    for (let n = 1; n <= 1000; n++) pacer.push(batch(n));
    // Everything up to the last bar shows at once; the last 16 pads play out.
    expect(seen.length).toBe(1000 - MAX_WAITING);
    advance(STEP_MS);
    expect(seen[seen.length - 1]).toBe(1000 - MAX_WAITING + 1);
    advance((MAX_WAITING - 1) * STEP_MS);
    expect(seen.length).toBe(1000);
  });

  it("lets slow batches through as they arrive", () => {
    const { t, advance } = clock();
    const seen: string[] = [];
    const pacer = createPacer((e) => seen.push(label(e)), { prescale: 1, timers: t });
    pacer.push(batch(1));
    advance(2_500);
    pacer.push(batch(2));
    expect(seen).toEqual(["b1", "b2"]);
  });

  it("lets everything through on skip, and after it", async () => {
    const { t } = clock();
    const seen: string[] = [];
    const pacer = createPacer((e) => seen.push(label(e)), { prescale: 1, timers: t });
    for (let n = 1; n <= 5; n++) pacer.push(batch(n));
    const drained = pacer.drained();
    pacer.skip();
    await drained;
    pacer.push(done(5));
    expect(seen).toEqual(["b1", "b2", "b3", "b4", "b5", "done"]);
  });

  it("doesn't pace at all with stepMs 0", () => {
    const { t } = clock();
    const seen: string[] = [];
    const pacer = createPacer((e) => seen.push(label(e)), { prescale: 1, stepMs: 0, timers: t });
    for (let n = 1; n <= 3; n++) pacer.push(batch(n));
    expect(seen).toEqual(["b1", "b2", "b3"]);
  });
});
