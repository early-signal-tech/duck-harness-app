// Takes in the rack's panel: each press of PLAY is a take (a RUN, an A/B, or a SETLIST),
// read back from the traces by the agent (duckdb_agent/takes.py, the `takes` request).
// The panel shows TAKE n OF m, ◂ ▸ to step through them; the newest one follows what's
// playing. These are the pure parts: titles, numbering, and a setlist take's grid.

import type { TakeRun, TakeSummary } from "@dh/dh1";

export const KIND_LABEL: Record<TakeSummary["kind"], string> = { run: "RUN", ab: "A/B", setlist: "SETLIST" };

/** What a take was: its prompt, or a setlist's name (else its question set). */
export function takeTitle(take: Pick<TakeSummary, "kind" | "prompt" | "setlist_name" | "question_set">): string {
  if (take.kind === "setlist") return take.setlist_name || `${take.question_set ?? "A"} setlist`;
  return take.prompt || "(no prompt)";
}

/** "2:05 PM · 3/4 completed · $0.0123", the facts under a take's title. */
export function takeFacts(take: TakeSummary, now = new Date()): string {
  const parts: string[] = [];
  if (take.started_at) {
    const at = new Date(take.started_at);
    const sameDay = at.toDateString() === now.toDateString();
    parts.push(sameDay
      ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : at.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
  }
  if (take.kind !== "run") parts.push(`${take.completed}/${take.runs} completed`);
  if (take.cost_usd != null) parts.push(`$${take.cost_usd.toFixed(4)}`);
  return parts.join(" · ");
}

/** Which take the panel shows: `index` into the takes (0 = newest), or null for "the
 *  newest", which is the one playing while something plays. */
export type TakePick = number | null;

/** The number shown for a pick, oldest = 1: "TAKE 12 OF 12". While a take is playing and
 *  not in the traces yet, it's the next number. */
export function takeNumber(pick: TakePick, count: number, playing: boolean): { n: number; of: number } {
  if (pick === null) return playing ? { n: count + 1, of: count + 1 } : { n: count, of: count };
  return { n: count - pick, of: count + (playing ? 1 : 0) };
}

/** Step to an older (-1, ◂) or newer (+1, ▸) take. Past the newest is "the newest" (null).
 *  With nothing `playing`, "the newest" is takes[0] itself, so ◂ goes to takes[1]. */
export function stepTake(pick: TakePick, count: number, direction: 1 | -1, playing = false): TakePick {
  if (count === 0) return null;
  // Where "the newest" sits: just ahead of takes[0] while one plays, else on it.
  const index = pick ?? (playing ? -1 : 0);
  const next = Math.min(index - direction, count - 1);
  return next < (playing ? 0 : 1) ? null : next;
}

/** A setlist take's runs as a grid: questions down, columns across, repeats in a cell. */
export function setlistGrid(runs: TakeRun[]): { questions: string[]; columns: string[]; cell: (q: string, c: string) => TakeRun[] } {
  const questions = [...new Set(runs.map((r) => String(r.labels.question ?? "?")))];
  const columns = [...new Set(runs.map((r) => String(r.labels.column ?? "A")))].sort();
  return {
    questions,
    columns,
    cell: (q, c) => runs.filter((r) => String(r.labels.question ?? "?") === q && String(r.labels.column ?? "A") === c),
  };
}
