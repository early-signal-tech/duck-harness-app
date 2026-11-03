// Client for EH-1's engine (eh1-grader's eh1-serve), JSON Lines like DH-1's agent. The
// Rust host starts it and relays lines: requests go out through `harness_send`, replies
// come back as `harness-message` events, and `harness-exit` carries the start's
// generation so a restarted engine's predecessor is ignored.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const PROTOCOL_VERSION = 1;

/** What a grade depends on besides the run (eh1_grader.grade.GraderSettings). */
export interface GraderSettings {
  name: string;
  revision: number;
  judge_model: string;
  judge_effort: string;
  tolerance: string;
  iteration_budget: number;
}

export interface Hello {
  protocol: number;
  defaults: GraderSettings;
  judge_models: string[];
}

/** The preset one column of a setlist ran, as the runs recorded it. */
export interface SetlistPreset {
  column: string;
  name: string | null;
  /** Its knobs were changed after loading it. */
  modified: boolean;
  /** The agent config the runs used (model, effort, max_iterations, …). */
  config: Record<string, unknown>;
}

/** How much of a setlist is graded with the grader settings `setlists` was asked about. */
export interface SetlistGrading {
  graded: number;
  /** Average total out of 6 over those grades (your overrides counted). */
  total: number | null;
  /** How many other grader settings (judge, tolerance, set revision, …) have graded it. */
  other_settings: number;
}

/** A setlist in the traces (newest first from `setlists`). */
export interface SetlistInfo {
  id: string;
  question_set: string;
  revision: number | null;
  /** Your name from EH-1, else the one DH-1 labelled the runs with. */
  name: string | null;
  note: string | null;
  concurrency: number | null;
  runs: number;
  completed: number;
  cancelled?: number;
  columns: number;
  repeats: number | null;
  cost_usd: number | null;
  started_at: string | null;
  ended_at: string | null;
  presets?: SetlistPreset[];
  grading?: SetlistGrading;
}

export interface RuleResult {
  label: string;
  passed: boolean;
  detail: string;
}

export type ValueCheck = "matches" | "differs" | "unverified";

export interface JudgedValue {
  name: string;
  agent: string;
  reference: string;
  /** Judge version 2: matches / differs / unverified (no reference gives the value). */
  check?: ValueCheck;
  /** Judge version 1 grades: a flag, with no way to say "unverified". */
  matches?: boolean;
}

/** A value's check, for grades from either judge version. */
export function valueCheck(v: JudgedValue): ValueCheck {
  if (v.check) return v.check;
  return v.matches ? "matches" : "differs";
}

/** A person's CORRECT and CAREFUL for a run, kept beside the judge's. */
export interface Override {
  correct: number;
  careful: number;
  why: string;
  at?: string;
}

/** One run's grade under one grader setting (eval_grades, joined with the run). */
export interface Grade {
  run_id: string;
  question: string;
  column: string | null;
  repeat: number | null;
  status: string;
  correct: number | null;
  careful: number | null;
  efficient: number | null;
  correct_reason: string | null;
  careful_reason: string | null;
  efficient_reason: string | null;
  judge_unsure: boolean | null;
  judge_values: JudgedValue[] | null;
  rules: RuleResult[] | null;
  rules_passed: boolean | null;
  judge_cost_usd: number | null;
  judge_error: string | null;
  override: Override | null;
  run_cost_usd: number | null;
}

export interface GradeSummary {
  setlist_run: string;
  grader_key: string;
  runs: number;
  graded: number;
  skipped: number;
  unmatched: number;
  judge_cost_usd: number;
  errors: string[];
  cancelled: boolean;
}

export type GradeEvent =
  | { event: "grade_start"; setlist_run: string; grader_key: string; runs: number; to_grade: number; skipped: number; unmatched: number }
  | {
      event: "graded"; run_id: string; question: string; column: string | null; repeat: number | null;
      correct: number | null; careful: number | null; efficient: number; rules_passed: boolean | null;
      judge_error: string | null; judge_cost_usd: number | null;
    }
  | { event: "grade_error"; run_id: string; question: string; error: string };

type Message =
  | ({ id: string; type: "hello" } & Hello)
  | { id: string; type: "setlists"; setlists: SetlistInfo[] }
  | { id: string; type: "grades"; grader_key: string; grades: Grade[] }
  | { id: string; type: "accepted" }
  | ({ id: string; type: "event" } & GradeEvent)
  | { id: string; type: "result"; result: GradeSummary }
  | { id: string; type: "ok" }
  | { id: string | null; type: "error"; error: string };

export class EngineError extends Error {}

interface Pending {
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  onEvent?: (event: GradeEvent) => void;
  isFinal: (message: Message) => boolean;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** A grading in progress: `done` resolves with the summary. */
export interface Grading {
  id: string;
  done: Promise<GradeSummary>;
  stop: () => Promise<void>;
}

export class Engine {
  private pending = new Map<string, Pending>();
  private unlisten: UnlistenFn[] = [];
  private exited = false;
  private generation = 0;
  onExit: () => void = () => {};

  static async connect(): Promise<Engine> {
    const engine = new Engine();
    engine.unlisten.push(
      await listen<string>("harness-message", ({ payload }) => engine.receive(payload)),
      await listen<number>("harness-exit", ({ payload }) => {
        if (payload === engine.generation) engine.serverExited();
      }),
    );
    engine.generation = await invoke<number>("engine_generation");
    return engine;
  }

  /** Stop listening; anything still waiting fails. */
  dispose(): void {
    this.unlisten.forEach((stop) => stop());
    this.unlisten = [];
    for (const pending of this.pending.values()) pending.reject(new EngineError("the engine was restarted"));
    this.pending.clear();
  }

  async hello(): Promise<Hello> {
    const reply = await this.request({ type: "hello" }, nextId("hello"));
    if (reply.type !== "hello") throw new EngineError(`unexpected reply ${reply.type}`);
    if (reply.protocol !== PROTOCOL_VERSION) {
      throw new EngineError(`the grader speaks protocol ${reply.protocol}; EH-1 needs ${PROTOCOL_VERSION}`);
    }
    const { id: _id, type: _type, ...hello } = reply;
    return hello;
  }

  /** The setlists in the traces. With grader settings (and the question sets the face has,
   *  so the engine grades with the same revision), each says how much is graded. */
  async setlists(grader?: GraderSettings, questionSets?: { id: string; revision: number }[]): Promise<SetlistInfo[]> {
    const body = grader ? { type: "setlists", grader, question_sets: questionSets ?? [] } : { type: "setlists" };
    const reply = await this.request(body, nextId("setlists"));
    if (reply.type !== "setlists") throw new EngineError(`unexpected reply ${reply.type}`);
    return reply.setlists;
  }

  /** A setlist's grades under these settings (and the set's id and revision). */
  async grades(setlistRun: string, questionSet: unknown, grader: GraderSettings): Promise<{ graderKey: string; grades: Grade[] }> {
    const reply = await this.request({ type: "grades", setlist_run: setlistRun, question_set: questionSet, grader }, nextId("grades"));
    if (reply.type !== "grades") throw new EngineError(`unexpected reply ${reply.type}`);
    return { graderKey: reply.grader_key, grades: reply.grades };
  }

  grade(
    setlistRun: string, questionSet: unknown, grader: GraderSettings,
    options: { regrade?: boolean; concurrency?: number; runIds?: string[] } = {},
    onEvent?: (event: GradeEvent) => void,
  ): Grading {
    const id = nextId("grade");
    const done = this.request(
      {
        type: "grade", setlist_run: setlistRun, question_set: questionSet, grader, regrade: !!options.regrade,
        concurrency: options.concurrency ?? 4, ...(options.runIds ? { run_ids: options.runIds } : {}),
      },
      id,
      { onEvent, isFinal: (m) => m.type === "result" || m.type === "error" },
    ).then((reply) => {
      if (reply.type !== "result") throw new EngineError(`unexpected reply ${reply.type}`);
      return reply.result;
    });
    return { id, done, stop: () => this.request({ type: "stop", grade: id }, nextId("stop")).then(() => {}) };
  }

  /** Set (or, with null, clear) your scores for one graded run. */
  async override(runId: string, questionSet: unknown, grader: GraderSettings, value: Omit<Override, "at"> | null): Promise<void> {
    const reply = await this.request({ type: "override", run_id: runId, question_set: questionSet, grader, override: value }, nextId("override"));
    if (reply.type !== "ok") throw new EngineError(`unexpected reply ${reply.type}`);
  }

  /** Your name and note for a setlist (null or blank shows DH-1's again). */
  async rename(setlistRun: string, name: string | null, note: string | null): Promise<void> {
    const reply = await this.request({ type: "rename", setlist_run: setlistRun, name, note }, nextId("rename"));
    if (reply.type !== "ok") throw new EngineError(`unexpected reply ${reply.type}`);
  }

  private request(body: Record<string, unknown>, id: string, options: Partial<Pick<Pending, "onEvent" | "isFinal">> = {}): Promise<Message> {
    if (this.exited) return Promise.reject(new EngineError("the grader is not running"));
    return new Promise<Message>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onEvent: options.onEvent, isFinal: options.isFinal ?? (() => true) });
      invoke("harness_send", { line: JSON.stringify({ id, ...body }) }).catch((e) => {
        this.pending.delete(id);
        reject(new EngineError(String(e)));
      });
    });
  }

  private receive(line: string): void {
    let message: Message;
    try {
      message = JSON.parse(line);
    } catch {
      console.warn("grader sent a line that isn't JSON:", line);
      return;
    }
    const pending = message.id == null ? undefined : this.pending.get(message.id);
    if (!pending) {
      if (message.type === "error") console.warn("grader:", message.error);
      return;
    }
    if (message.type === "accepted") return;
    if (message.type === "event") {
      const { id: _id, type: _type, ...event } = message;
      try {
        pending.onEvent?.(event as GradeEvent);
      } catch (e) {
        console.error("event handler failed:", e);
      }
      return;
    }
    if (!pending.isFinal(message)) return;
    this.pending.delete(message.id!);
    if (message.type === "error") pending.reject(new EngineError(message.error));
    else pending.resolve(message);
  }

  private serverExited(): void {
    if (this.exited) return;
    this.exited = true;
    for (const pending of this.pending.values()) pending.reject(new EngineError("the grader stopped"));
    this.pending.clear();
    this.onExit();
  }
}
