// What PB-1's rack card shows (Pb1Card): the panel works it out from its own state and hands
// it to the rack through `onSummary`, so the card is exactly as fresh as the panel.

import type { DoneEvent } from "./events";
import { barOf, padOf, type Pad, type Sequence } from "./sequencer";
import type { Pb1Settings } from "./settings";

export interface Pb1Summary {
  /** The CATALOG knob: local duckdb, local postgres, or a DuckLake secret's name. */
  catalog: string;
  /** The MODE tile: the mode as its label, its tempo and length as the value, e.g. BATCH / "10k × 5". */
  mode: { label: string; value: string };
  table: string;
  /** The card's last tile: the last run's rows/s, or a run's rows as it plays. */
  stat: { label: string; value: string };
  /** The card's small display: a heading and one line. */
  display: { title: string; line: string };
  pads: Pad[];
  /** The pad whose step lamp is lit, or -1. */
  lit: number;
  /** What's playing ("BATCH: running…", "reset…"), or null. */
  busy: string | null;
  /** What's wrong (the engine is down), or null. */
  problem: string | null;
}

export interface SummaryInput {
  settings: Pb1Settings;
  status: "ready" | "connecting" | "down";
  error: string | null;
  powered: boolean;
  phase: "idle" | "setup" | "reset" | "running";
  seq: Sequence | null;
  /** The panel's own status line. */
  statusLine: string;
  table: string;
  blankPads: Pad[];
}

const short = (v: number) => (v >= 1_000_000 ? `${v / 1_000_000}M` : v >= 1_000 ? `${v / 1_000}k` : String(v));
const rate = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${Math.round(v / 1_000)}k` : String(Math.round(v)));
const plural = (n: number, unit: string) => `${n.toLocaleString()} ${unit}${n === 1 ? "" : unit === "batch" ? "es" : "s"}`;

export function modeTile(s: Pb1Settings): Pb1Summary["mode"] {
  if (s.mode === "BATCH") return { label: "BATCH", value: `${short(s.batchSize)} × ${s.length || "∞"}` };
  if (s.mode === "STREAM") return { label: "STREAM", value: `${s.tickInterval}s · ${s.length ? `${s.length} min` : "∞"}` };
  return { label: "MODE", value: s.mode };
}

function doneLine(done: DoneEvent, unit: "batch" | "tick") {
  return `${done.rows_total.toLocaleString()} rows · ${plural(done.steps, unit)}`;
}

export function summarize(input: SummaryInput): Pb1Summary {
  const { settings: s, status, powered, phase, seq } = input;
  const running = phase === "running";
  const unit = seq?.unit ?? (s.mode === "STREAM" ? "tick" : "batch");
  const step = seq?.step ?? 0;
  const done = seq?.done ?? null;

  const problem = status === "down" ? `The pb1 bridge isn't running${input.error ? `: ${input.error}` : "."}` : null;

  let stat: Pb1Summary["stat"] = { label: "LAST RUN", value: done ? `${rate(done.rows_per_sec)} rows/s` : "–" };
  if (running && seq) {
    stat = unit === "tick"
      ? { label: "ROWS·DUP·DRIFT", value: `${seq.rows.toLocaleString()} · ${seq.duplicates} · ${seq.drifts}` }
      : { label: "ROWS", value: seq.rows.toLocaleString() };
  }

  let display: Pb1Summary["display"];
  if (status === "down") display = { title: "OFFLINE", line: "engine isn't running" };
  else if (!powered) display = { title: "OFF", line: "PB-1 is switched off" };
  else if (status === "connecting") display = { title: "STARTING", line: "starting the engine…" };
  else if (running && step > 0) display = { title: `BAR ${barOf(step)} · STEP ${step}`, line: input.statusLine };
  else if (phase !== "idle") display = { title: phase === "running" ? "STARTING" : phase.toUpperCase(), line: input.statusLine };
  else if (done) display = { title: done.reason === "interrupted" ? "STOPPED" : "DONE", line: doneLine(done, unit) };
  else display = { title: "READY", line: `${s.mode.toLowerCase()} · ${s.catalog}` };

  const busy = running ? `${s.mode === "STREAM" ? "STREAM" : "BATCH"}: running…` : phase === "setup" || phase === "reset" ? `${phase}…` : null;

  return {
    catalog: s.catalog,
    mode: modeTile(s),
    table: input.table,
    stat,
    display,
    pads: seq?.pads ?? input.blankPads,
    lit: running && step > 0 ? padOf(step) : -1,
    busy,
    problem,
  };
}
