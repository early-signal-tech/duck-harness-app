// CH-1's rules, with no React in them: what a conversation is made of, which data a
// question can run on, and how turns and times are shown. useChat.ts drives them.
//
// The engine's rules (duckdb_agent/follow_up.py): a conversation has at most max_turns
// questions; a follow-up stays on the conversation's data or switches to another
// database, never to loaded files or TPC-H data.

import { describeSource, type SourceSpec } from "@dh/formats";
import { isAnswer, type AgentResult, type Answer, type ConversationTurn, type RunView, type Source } from "@dh/dh1";

/** What the engine allows until it says otherwise. */
export const DEFAULT_MAX_TURNS = 3;

/** One choice in the DATA menu. */
export interface DataChoice {
  label: string;
  source: Source;
}

/** One question and its answer. A turn still running has `running` and its live view. */
export interface Turn {
  /** Stable for React: the run id once known. */
  key: string;
  runId: string | null;
  prompt: string;
  answer: string | null;
  structured: Answer | null;
  status: string | null;
  error: string | null;
  iterations: number | null;
  queries: number;
  durationMs: number | null;
  costUsd: number | null;
  running: boolean;
  /** The live run (activity), for turns asked in this session. */
  view: RunView | null;
}

export const isDatabase = (source: Source): source is { db: string; schema?: string | null } => "db" in source;

/** The first question can use anything; a follow-up can stay on the conversation's data
 *  (`current`) or switch to a database. */
export function canUse(source: Source, turnsSoFar: number, current: Source | null = null): boolean {
  return turnsSoFar === 0 || isDatabase(source) || sameData(source, current);
}

export function sameData(a: Source | null, b: Source | null): boolean {
  if (!a || !b) return a === b;
  const norm = (s: Source) => JSON.stringify(isDatabase(s) ? { db: s.db, schema: s.schema ?? null } : { load: s.load ?? null, tpch: s.tpch ?? null });
  return norm(a) === norm(b);
}

function specOf(source: Source): SourceSpec | null {
  if (isDatabase(source)) return { kind: "db", dbPath: source.db, ...(source.schema ? { schema: source.schema } : {}) };
  if (source.load?.length) return { kind: "files", files: source.load };
  if (source.tpch) return { kind: "tpch", tpchScale: source.tpch };
  return null;
}

/** A source in a few words: "TPC-H 0.1", "shop.duckdb", "orders · S3", "3 files". */
export function describeData(source: Source | null): string {
  const spec = source && specOf(source);
  return spec ? describeSource(spec) : "unknown data";
}

/** When a conversation was last active: "now", "14:05" today, "yesterday", or "Nov 21". */
export function when(iso: string | null, now = new Date()): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  if (now.getTime() - at.getTime() < 2 * 60_000) return "now";
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (days === 1) return "yesterday";
  return at.toLocaleDateString([], { month: "short", day: "numeric" });
}

export const money = (usd: number | null | undefined) => `$${(usd ?? 0).toFixed(4)}`;

/** A structured answer comes back from the traces as JSON text. */
export function structuredOf(text: string | null): Answer | null {
  if (!text || !text.trimStart().startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isAnswer(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function turnFromTrace(t: ConversationTurn): Turn {
  return {
    key: t.run_id, runId: t.run_id, prompt: t.prompt, answer: t.answer, structured: structuredOf(t.answer), status: t.status,
    error: t.error, iterations: t.iterations, queries: t.queries, durationMs: t.duration_ms, costUsd: t.cost_usd,
    running: false, view: null,
  };
}

/** The queries a live run made. */
export function queriesIn(view: RunView): number {
  return view.iterations.reduce((n, it) => n + it.tools.filter((t) => t.tool === "query_database").length, 0);
}

export function turnFromResult(prompt: string, result: AgentResult, view: RunView): Turn {
  return {
    key: result.run_id, runId: result.run_id, prompt, answer: result.text || null,
    structured: isAnswer(result.answer) ? result.answer : null, status: result.status, error: result.error,
    iterations: result.iterations, queries: queriesIn(view), durationMs: result.duration_ms,
    costUsd: result.estimated_cost_usd, running: false, view,
  };
}

/** What a finished turn's status means for the person reading it; null when it answered. */
export function statusNote(turn: Turn): string | null {
  if (turn.running || turn.status === "completed") return null;
  if (turn.status === "cancelled") return "Stopped before it answered.";
  if (turn.status === "max_iterations") return "Ran out of iterations before a final answer.";
  if (turn.error) return turn.error;
  return turn.status ? `Ended: ${turn.status.replace(/_/g, " ")}.` : null;
}
