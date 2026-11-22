// Paces a BATCH run's events so each pad can be seen lighting.
//
// Parkbench writes batches back to back: five 10,000-row batches into local DuckDB take about
// 0.06s, so without pacing the pads jump straight from blank to DONE. The pacer holds events in
// order and lets a new step (a new pad) through every STEP_MS. When more than a bar of pads is
// waiting, it jumps ahead so only the last bar plays out: the panel is never more than about
// one bar (16 × STEP_MS) behind the run.
// Events that don't start a step (a flush, the done event, batches inside a PRE-SCALE group)
// pass straight through behind the step before them, except DONE, which lets the last pad
// show for one step. Parkbench's numbers are untouched.

import type { RunEvent } from "./events";

/** The time between two pads lighting. */
export const STEP_MS = 500;
/** The most pads left waiting: one bar. More than this and the pads jump ahead. */
export const MAX_WAITING = 16;

export interface Timers {
  now: () => number;
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: Timers = {
  now: () => performance.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface Pacer {
  push: (event: RunEvent) => void;
  /** Let everything queued through now, and everything after it too. STOP during a replay. */
  skip: () => void;
  /** Resolves once every event pushed so far has been let through. */
  drained: () => Promise<void>;
}

export interface PacerOptions {
  /** Batches per pad, as the sequencer counts them. */
  prescale: number;
  /** 0 lets every event straight through: STREAM (paced by TEMPO) and TAP. */
  stepMs?: number;
  timers?: Timers;
}

export function createPacer(emit: (event: RunEvent) => void, { prescale, stepMs = STEP_MS, timers = realTimers }: PacerOptions): Pacer {
  const per = Math.max(1, prescale);
  const queue: RunEvent[] = [];
  let released = 0; // batch events let through
  let lastStep = -Infinity;
  let timer: unknown = null;
  let skipping = stepMs <= 0;
  let waiters: (() => void)[] = [];

  /** Steps waiting in the queue, counting the one at its head. */
  const queuedSteps = () => {
    let batches = released;
    let steps = 0;
    for (const event of queue) {
      if (event.event !== "batch") continue;
      if (batches % per === 0) steps++;
      batches++;
    }
    return steps;
  };

  const pump = () => {
    timer = null;
    while (queue.length > 0) {
      const event = queue[0];
      // The last pad gets its beat too: DONE waits one step after it.
      if (!skipping && event.event === "done" && timers.now() < lastStep + stepMs) {
        timer = timers.set(pump, lastStep + stepMs - timers.now());
        return;
      }
      if (!skipping && event.event === "batch" && released % per === 0 && queuedSteps() <= MAX_WAITING) {
        const now = timers.now();
        if (now < lastStep + stepMs) {
          timer = timers.set(pump, lastStep + stepMs - now);
          return;
        }
        lastStep = now;
      }
      queue.shift();
      if (event.event === "batch") released++;
      emit(event);
    }
    const done = waiters;
    waiters = [];
    done.forEach((resolve) => resolve());
  };

  return {
    push: (event) => {
      queue.push(event);
      // A longer queue may shorten the wait already set, so work it out again.
      if (timer !== null) timers.clear(timer);
      pump();
    },
    skip: () => {
      skipping = true;
      if (timer !== null) timers.clear(timer);
      pump();
    },
    drained: () => (queue.length === 0 ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve))),
  };
}
