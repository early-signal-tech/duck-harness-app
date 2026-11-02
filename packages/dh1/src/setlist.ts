// The Setlist: run a question set with several presets, several times each, and compare
// how the presets behave (cost, iterations, time, limits, spread between repeats).
// Grading the answers is EH-1's job; every run is labelled so EH-1 can find it.
//
// This file is the model: the plan, the jobs and their states (a reducer), and the
// numbers the grid shows. useSetlist.ts runs it; components/SetlistView.tsx draws it.

import {
  FACTORY_QUESTION_SETS, questionSource, type Question, type QuestionSet,
} from "@dh/formats";
import type { AgentResult, RunRequest } from "./harness";
import { applyPreset, type Preset } from "./presets";
import { requestOf, type FaceSettings } from "./settings";

export const COLUMN_KEYS = ["A", "B", "C", "D"] as const;
export const MAX_COLUMNS = COLUMN_KEYS.length;
export const REPEAT_CHOICES = [1, 2, 3, 4, 5] as const;
export const CONCURRENCY_CHOICES = [1, 2, 3, 4, 6] as const;

export const MAX_NAME = 80;
export const MAX_NOTE = 200;

export interface SetlistPlan {
  /** The name, when you edited the suggested one: stored exactly as setlist_name.
   *  Left as suggested, there's no name and the title is built from the facts, which
   *  are already in their own fields, so no generated text is stored. */
  name?: string;
  /** Optional, one line. */
  note?: string;
  set: QuestionSet;
  /** One column per preset, A, B, C, D. Copied when the setlist starts, so editing a
   *  preset mid-run doesn't change what the rest of the runs use. */
  columns: Preset[];
  repeats: number;
  /** How many runs go at once. */
  concurrency: number;
}

export type JobState = "queued" | "running" | "done" | "failed" | "skipped";

export interface Job {
  index: number;
  question: string;
  column: number;
  /** 1-based. */
  repeat: number;
  state: JobState;
  /** The iteration a running job is on. */
  iteration: number;
  result: AgentResult | null;
  error: string | null;
}

export type SetlistPhase = "idle" | "running" | "stopping" | "done";

export interface SetlistState {
  phase: SetlistPhase;
  /** Labels every run of one setlist, so they can be found together in the traces. */
  runId: string | null;
  plan: SetlistPlan | null;
  jobs: Job[];
  startedAt: number | null;
  endedAt: number | null;
}

export const SETLIST_IDLE: SetlistState = { phase: "idle", runId: null, plan: null, jobs: [], startedAt: null, endedAt: null };

export type SetlistAction =
  | { type: "start"; plan: SetlistPlan; runId: string; at: number }
  | { type: "jobStarted"; index: number }
  | { type: "iteration"; index: number; iteration: number }
  | { type: "jobDone"; index: number; result: AgentResult; at: number }
  | { type: "jobFailed"; index: number; error: string; at: number }
  | { type: "stop"; at: number }
  | { type: "clear" };

/** The suggested name, built from the setlist's facts: "TPC-H · 3 presets × 3 · Nov 2,
 *  14:05". It fills the NAME box; it's never stored (see SetlistPlan.name). */
export function suggestedSetlistName(
  plan: Pick<SetlistPlan, "set" | "columns" | "repeats">,
  startedAt: Date = new Date(),
): string {
  const presets = `${plan.columns.length} preset${plan.columns.length === 1 ? "" : "s"}`;
  const day = startedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = `${String(startedAt.getHours()).padStart(2, "0")}:${String(startedAt.getMinutes()).padStart(2, "0")}`;
  return `${plan.set.name} · ${presets} × ${plan.repeats} · ${day}, ${time}`;
}

/** What a setlist is called on screen: your name, or the suggestion rebuilt from its facts. */
export function setlistTitle(
  plan: Pick<SetlistPlan, "set" | "columns" | "repeats" | "name">,
  startedAt: Date = new Date(),
): string {
  return plan.name || suggestedSetlistName(plan, startedAt);
}

/** A setlist's ID, unique and sortable: "sl-2026-11-02-1405-a7f1" (local start date and
 *  time, then 4 random characters). Names can repeat; this can't. It's the setlist_run
 *  label on every run. */
export function newSetlistRunId(date: Date = new Date(), random: () => number = Math.random): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}`;
  const tail = Array.from({ length: 4 }, () => "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(random() * 32)]).join("");
  return `sl-${day}-${time}-${tail}`;
}

/** The name and note to record: trimmed, one line, within the label limits. */
export function cleanName(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export function jobCount(plan: Pick<SetlistPlan, "set" | "columns" | "repeats">): number {
  return plan.set.questions.length * plan.columns.length * plan.repeats;
}

/** The order runs go in: question by question, and within a question, repeat by repeat
 *  across the columns. A question's columns run close together in time, so a slow
 *  patch on the API affects them alike instead of landing on one preset. */
export function planJobs(plan: SetlistPlan): Job[] {
  const jobs: Job[] = [];
  for (const question of plan.set.questions) {
    for (let repeat = 1; repeat <= plan.repeats; repeat++) {
      for (let column = 0; column < plan.columns.length; column++) {
        jobs.push({
          index: jobs.length, question: question.id, column, repeat, state: "queued", iteration: 0, result: null, error: null,
        });
      }
    }
  }
  return jobs;
}

const isOpen = (job: Job) => job.state === "queued" || job.state === "running";

function settle(state: SetlistState, at: number): SetlistState {
  if (state.phase === "idle" || state.phase === "done" || state.jobs.some(isOpen)) return state;
  return { ...state, phase: "done", endedAt: at };
}

function patchJob(state: SetlistState, index: number, patch: Partial<Job>): SetlistState {
  const jobs = state.jobs.slice();
  jobs[index] = { ...jobs[index], ...patch };
  return { ...state, jobs };
}

export function setlistReducer(state: SetlistState, action: SetlistAction): SetlistState {
  switch (action.type) {
    case "start":
      return { phase: "running", runId: action.runId, plan: action.plan, jobs: planJobs(action.plan), startedAt: action.at, endedAt: null };
    case "jobStarted":
      return state.jobs[action.index]?.state === "queued" ? patchJob(state, action.index, { state: "running" }) : state;
    case "iteration":
      return state.jobs[action.index]?.state === "running" ? patchJob(state, action.index, { iteration: action.iteration }) : state;
    case "jobDone":
      if (!state.jobs[action.index]) return state;
      return settle(patchJob(state, action.index, { state: "done", result: action.result }), action.at);
    case "jobFailed":
      if (!state.jobs[action.index]) return state;
      return settle(patchJob(state, action.index, { state: "failed", error: action.error }), action.at);
    case "stop": {
      if (state.phase !== "running") return state;
      const jobs = state.jobs.map((job) => (job.state === "queued" ? { ...job, state: "skipped" as const } : job));
      return settle({ ...state, phase: "stopping", jobs }, action.at);
    }
    case "clear":
      return state.phase === "running" || state.phase === "stopping" ? state : SETLIST_IDLE;
  }
}

/** The queued jobs to start now, keeping `concurrency` running at once. */
export function nextJobs(state: SetlistState): Job[] {
  if (state.phase !== "running" || !state.plan) return [];
  const running = state.jobs.filter((j) => j.state === "running").length;
  const room = state.plan.concurrency - running;
  return room > 0 ? state.jobs.filter((j) => j.state === "queued").slice(0, room) : [];
}

// --- what a run sends ---

/** The run for one job: the preset's settings, on the question's own source (not the
 *  preset's), asking the question's prompt. Labelled for EH-1 and the traces. */
export function jobRequest(face: FaceSettings, state: SetlistState, job: Job): RunRequest {
  const plan = state.plan!;
  const question = plan.set.questions.find((q) => q.id === job.question)!;
  const preset = plan.columns[job.column];
  const source = questionSource(plan.set, question);
  const settings = applyPreset({ ...face, prompt: question.prompt }, { ...preset, source });
  return requestOf(
    settings,
    { id: preset.id, name: preset.name, revision: preset.revision, modified: false },
    {
      setlist: plan.set.id,
      setlist_revision: plan.set.revision,
      setlist_run: state.runId,
      // How many ran at once: overlapping runs take longer, so timings from setlists
      // run at different concurrency aren't comparable.
      setlist_concurrency: plan.concurrency,
      ...(plan.name ? { setlist_name: plan.name } : {}),
      ...(plan.note ? { setlist_note: plan.note } : {}),
      question: question.id,
      column: COLUMN_KEYS[job.column],
      repeat: job.repeat,
    },
  );
}

// --- what the grid shows ---

/** A lamp per repeat: completed, hit a limit, error, running, queued, or skipped (stopped). */
export type Lamp = "ok" | "limit" | "error" | "run" | "queue" | "skip";

const LIMITS = new Set(["max_iterations", "max_tokens", "context_window_exceeded"]);

export function lampOf(job: Job): Lamp {
  switch (job.state) {
    case "queued":
      return "queue";
    case "running":
      return "run";
    case "skipped":
      return "skip";
    case "failed":
      return "error";
    case "done": {
      const status = job.result?.status;
      if (status === "completed") return "ok";
      if (status === "cancelled") return "skip";
      return status && LIMITS.has(status) ? "limit" : "error";
    }
  }
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** How far repeats' costs stray from their median: half the range, as a fraction of the
 *  median (0.12 = ±12%). Needs two finished repeats. */
export function spread(values: number[]): number | null {
  if (values.length < 2) return null;
  const mid = median(values)!;
  if (mid <= 0) return null;
  return (Math.max(...values) - Math.min(...values)) / 2 / mid;
}

/** Jobs that produced a result worth counting (not stopped). */
const finished = (jobs: Job[]) => jobs.filter((j) => j.state === "done" && j.result && j.result.status !== "cancelled");
const costs = (jobs: Job[]) => finished(jobs).map((j) => j.result!.estimated_cost_usd).filter((c): c is number => c != null);

export interface CellStats {
  lamps: Lamp[];
  running: Job | undefined;
  allQueued: boolean;
  medCost: number | null;
  medIterations: number | null;
  medSeconds: number | null;
  spread: number | null;
}

export function cellJobs(state: SetlistState, question: string, column: number): Job[] {
  return state.jobs.filter((j) => j.question === question && j.column === column).sort((a, b) => a.repeat - b.repeat);
}

export function cellStats(jobs: Job[]): CellStats {
  const done = finished(jobs);
  return {
    lamps: jobs.map(lampOf),
    running: jobs.find((j) => j.state === "running"),
    allQueued: jobs.length > 0 && jobs.every((j) => j.state === "queued"),
    medCost: median(costs(jobs)),
    medIterations: median(done.map((j) => j.result!.iterations)),
    medSeconds: median(done.map((j) => j.result!.duration_ms / 1000)),
    spread: spread(costs(jobs)),
  };
}

export interface ColumnSummary {
  total: number;
  completed: number;
  totalCost: number;
  medCost: number | null;
  medIterations: number | null;
  medSeconds: number | null;
  /** The median of the cells' spreads. */
  spread: number | null;
  limits: number;
  errors: number;
}

export function columnSummary(state: SetlistState, column: number): ColumnSummary {
  const jobs = state.jobs.filter((j) => j.column === column);
  const done = finished(jobs);
  const questions = state.plan?.set.questions ?? [];
  const spreads = questions
    .map((q) => spread(costs(cellJobs(state, q.id, column))))
    .filter((s): s is number => s !== null);
  const lamps = jobs.map(lampOf);
  return {
    total: jobs.length,
    completed: lamps.filter((l) => l === "ok").length,
    totalCost: costs(jobs).reduce((a, b) => a + b, 0),
    medCost: median(costs(jobs)),
    medIterations: median(done.map((j) => j.result!.iterations)),
    medSeconds: median(done.map((j) => j.result!.duration_ms / 1000)),
    spread: median(spreads),
    limits: lamps.filter((l) => l === "limit").length,
    errors: lamps.filter((l) => l === "error").length,
  };
}

export interface Progress {
  total: number;
  /** Finished one way or another (done, failed, or skipped). */
  settled: number;
  running: number;
  spent: number;
  /** Spent so far plus, for each run still to go, its column's median cost so far.
   *  Null until every column with runs left has finished at least one. */
  projected: number | null;
}

export function progressOf(state: SetlistState): Progress {
  const total = state.jobs.length;
  const settled = state.jobs.filter((j) => !isOpen(j)).length;
  const running = state.jobs.filter((j) => j.state === "running").length;
  const spent = state.jobs.reduce((sum, j) => sum + (j.result?.estimated_cost_usd ?? 0), 0);
  let projected: number | null = spent;
  const columns = state.plan?.columns.length ?? 0;
  for (let column = 0; column < columns; column++) {
    const left = state.jobs.filter((j) => j.column === column && isOpen(j)).length;
    if (!left) continue;
    const typical = median(costs(state.jobs.filter((j) => j.column === column)));
    if (typical === null) {
      projected = null;
      break;
    }
    projected += left * typical;
  }
  return { total, settled, running, spent, projected };
}

/** "has a check" / "no check", for the question column. */
export function checkNote(question: Question): string {
  const c = question.check;
  return c && (c.sql || c.tpchQuery !== undefined || c.expect) ? "has a check" : "no check";
}

// --- the plan the screen remembers between launches (not the results) ---

export interface SavedPlan {
  setId: string;
  columnIds: string[];
  repeats: number;
  concurrency: number;
}

const PLAN_KEY = "dh1.setlist";

export const DEFAULT_SAVED_PLAN: SavedPlan = {
  setId: FACTORY_QUESTION_SETS[0].id,
  columnIds: ["factory-quick", "factory-balanced", "factory-deep"],
  repeats: 3,
  concurrency: 3,
};

export function loadSavedPlan(): SavedPlan {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAN_KEY) ?? "null");
    if (saved && typeof saved === "object") {
      const plan = { ...DEFAULT_SAVED_PLAN, ...saved } as SavedPlan;
      if (!(REPEAT_CHOICES as readonly number[]).includes(plan.repeats)) plan.repeats = DEFAULT_SAVED_PLAN.repeats;
      if (!(CONCURRENCY_CHOICES as readonly number[]).includes(plan.concurrency)) plan.concurrency = DEFAULT_SAVED_PLAN.concurrency;
      if (!Array.isArray(plan.columnIds)) plan.columnIds = DEFAULT_SAVED_PLAN.columnIds;
      plan.columnIds = plan.columnIds.filter((id) => typeof id === "string").slice(0, MAX_COLUMNS);
      return plan;
    }
  } catch {
    // Unreadable or blocked storage: use the defaults.
  }
  return DEFAULT_SAVED_PLAN;
}

export function savePlan(plan: SavedPlan): void {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  } catch {
    // Not worth interrupting anyone over.
  }
}
