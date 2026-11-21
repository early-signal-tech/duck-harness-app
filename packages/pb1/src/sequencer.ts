// The step sequencer: Parkbench's events in, the 16 pads and the display out.
//
// One step covers PRE-SCALE events (batches or ticks). The pads wrap from 16 back to 1, and
// a new bar clears them, but the step count keeps going (17, 18, ...), shown as BAR and STEP.
// A pad's mark is the worst thing that happened in its step: drift beats a duplicate, which
// beats a plain insert. A flush to Parquet outlines the pad of the step it happened in.

import type { DoneEvent, RunEvent } from "./events";

export const PADS = 16;

export type PadMark = "ok" | "dup" | "drift";

export interface Pad {
  mark: PadMark | null;
  flush: boolean;
}

export interface Sequence {
  prescale: number;
  /** Batches or ticks seen. */
  events: number;
  /** Steps started: events / prescale, rounded up. */
  step: number;
  pads: Pad[];
  rows: number;
  rowsPerSec: number;
  drifts: number;
  duplicates: number;
  /** A flush for a step that hasn't started yet: a batch's flush comes before its batch. */
  pendingFlush: number | null;
  lastDrift: string | null;
  /** The newest event, for the display's status line. */
  last: RunEvent | null;
  /** What a step counts, once the first one lands. */
  unit: "batch" | "tick" | null;
  done: DoneEvent | null;
}

const emptyPads = (): Pad[] => Array.from({ length: PADS }, () => ({ mark: null, flush: false }));

export function startSequence(prescale: number): Sequence {
  return {
    prescale: Math.max(1, prescale), events: 0, step: 0, pads: emptyPads(), rows: 0, rowsPerSec: 0,
    drifts: 0, duplicates: 0, pendingFlush: null, lastDrift: null, last: null, unit: null, done: null,
  };
}

/** The pad a step lights, 0 to 15. */
export const padOf = (step: number) => (step - 1) % PADS;
/** The bar a step is in, from 1. */
export const barOf = (step: number) => (step > 0 ? Math.floor((step - 1) / PADS) + 1 : 1);

const RANK: Record<PadMark, number> = { ok: 0, dup: 1, drift: 2 };
const worst = (a: PadMark | null, b: PadMark): PadMark => (a && RANK[a] > RANK[b] ? a : b);

export function advance(seq: Sequence, event: RunEvent): Sequence {
  return { ...apply(seq, event), last: event };
}

function apply(seq: Sequence, event: RunEvent): Sequence {
  switch (event.event) {
    case "batch":
    case "tick": {
      const events = seq.events + 1;
      const step = Math.ceil(events / seq.prescale);
      const pads = step > seq.step && padOf(step) === 0 ? emptyPads() : seq.pads.slice();
      const at = padOf(step);
      const mark: PadMark = event.event === "tick" ? (event.drift ? "drift" : event.duplicate ? "dup" : "ok") : "ok";
      const flush = pads[at].flush || seq.pendingFlush === step;
      pads[at] = { mark: worst(step === seq.step ? pads[at].mark : null, mark), flush };
      return {
        ...seq, events, step, pads, unit: event.event,
        rows: event.rows_total,
        rowsPerSec: event.rows_per_sec,
        drifts: event.event === "tick" ? event.drifts : seq.drifts,
        duplicates: event.event === "tick" ? event.duplicates : seq.duplicates,
        pendingFlush: seq.pendingFlush === step ? null : seq.pendingFlush,
      };
    }
    case "flush": {
      // Batch mode names the batch it follows; a stream flushes once, after its last tick.
      const target = event.batch != null ? Math.ceil(event.batch / seq.prescale) : seq.step;
      if (target > seq.step || target === 0) return { ...seq, pendingFlush: target || 1 };
      if (target < seq.step - padOf(seq.step)) return seq; // an earlier bar's: its pads are gone
      const pads = seq.pads.slice();
      pads[padOf(target)] = { ...pads[padOf(target)], flush: true };
      return { ...seq, pads };
    }
    case "drift":
      return { ...seq, lastDrift: event.error.split("\n")[0] };
    case "done":
      return { ...seq, done: event, rows: event.rows_total, rowsPerSec: event.rows_per_sec, drifts: event.drifts, duplicates: event.duplicates };
  }
}
