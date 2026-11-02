import { describe, expect, it } from "vitest";
import { FACTORY_QUESTION_SETS, type QuestionSet } from "@dh/formats";
import type { AgentResult } from "../harness";
import { FACTORY_PRESETS } from "../presets";
import { DEFAULT_SETTINGS } from "../settings";
import {
  cellJobs, cellStats, cleanName, newSetlistRunId, setlistTitle, columnSummary, jobRequest, lampOf, median, nextJobs, planJobs, progressOf, SETLIST_IDLE,
  setlistReducer, spread, type SetlistPlan, type SetlistState,
} from "../setlist";

const set: QuestionSet = {
  id: "mini", name: "Mini", description: "", revision: 2, savedAt: "",
  source: { kind: "tpch", tpchScale: 0.01 },
  questions: [
    { id: "q1", title: "One", prompt: "First question?", tags: [], check: { tpchQuery: 1 } },
    { id: "q2", title: "Two", prompt: "Second question?", tags: [], source: { kind: "db", dbPath: "/data/x.duckdb" } },
  ],
};
const [quick, balanced] = FACTORY_PRESETS;
const plan: SetlistPlan = { name: "Effort check", note: "low vs medium", set, columns: [quick, balanced], repeats: 2, concurrency: 3 };

const result = (over: Partial<AgentResult> = {}): AgentResult => ({
  run_id: "r", status: "completed", text: "answer", iterations: 4, stop_reason: "end_turn", error: null, retryable: false,
  answer: null, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  estimated_cost_usd: 0.01, api_calls: 4, duration_ms: 8000, ...over,
});

const started = (): SetlistState => setlistReducer(SETLIST_IDLE, { type: "start", plan, runId: "sl-1", at: 0 });

function finish(state: SetlistState, index: number, r: AgentResult = result()): SetlistState {
  state = setlistReducer(state, { type: "jobStarted", index });
  return setlistReducer(state, { type: "jobDone", index, result: r, at: 1 });
}

describe("planning", () => {
  it("makes questions × columns × repeats jobs, a question's columns side by side in time", () => {
    const jobs = planJobs(plan);
    expect(jobs).toHaveLength(8);
    expect(jobs.slice(0, 4).map((j) => [j.question, j.repeat, j.column])).toEqual([
      ["q1", 1, 0], ["q1", 1, 1], ["q1", 2, 0], ["q1", 2, 1],
    ]);
  });

  it("starts up to the concurrency limit, then one more as each finishes", () => {
    let state = started();
    const first = nextJobs(state);
    expect(first.map((j) => j.index)).toEqual([0, 1, 2]);
    for (const j of first) state = setlistReducer(state, { type: "jobStarted", index: j.index });
    expect(nextJobs(state)).toEqual([]);
    state = setlistReducer(state, { type: "jobDone", index: 1, result: result(), at: 1 });
    expect(nextJobs(state).map((j) => j.index)).toEqual([3]);
  });

  it("is done when every job has settled", () => {
    let state = started();
    for (let i = 0; i < 8; i++) state = finish(state, i);
    expect(state.phase).toBe("done");
    expect(state.endedAt).toBe(1);
  });

  it("STOP skips what's queued and lets running runs finish as stopped", () => {
    let state = setlistReducer(started(), { type: "jobStarted", index: 0 });
    state = setlistReducer(state, { type: "stop", at: 2 });
    expect(state.phase).toBe("stopping");
    expect(nextJobs(state)).toEqual([]);
    expect(state.jobs.filter((j) => j.state === "skipped")).toHaveLength(7);
    state = setlistReducer(state, { type: "jobDone", index: 0, result: result({ status: "cancelled" }), at: 3 });
    expect(state.phase).toBe("done");
    expect(lampOf(state.jobs[0])).toBe("skip");
  });

  it("won't clear while running", () => {
    expect(setlistReducer(started(), { type: "clear" }).phase).toBe("running");
  });
});

describe("the request for a job", () => {
  it("uses the column's preset, the question's prompt and source, and labels the run", () => {
    const state = started();
    const face = { ...DEFAULT_SETTINGS, prompt: "something on the face", tpchScale: 1, effort: "max" as const };
    const first = jobRequest(face, state, state.jobs[0]); // q1, column A, repeat 1
    expect(first.prompt).toBe("First question?");
    expect(first.source).toEqual({ tpch: 0.01 }); // the set's, not Quick & Cheap's own or the face's
    expect(first.config?.effort).toBe("low");
    expect(first.config?.max_iterations).toBe(10);
    expect(first.preset).toEqual({ id: quick.id, name: quick.name, revision: quick.revision, modified: false });
    expect(first.labels).toEqual({
      setlist: "mini", setlist_revision: 2, setlist_run: "sl-1", setlist_name: "Effort check", setlist_note: "low vs medium",
      question: "q1", column: "A", repeat: 1,
    });

    const last = jobRequest(face, state, state.jobs[7]); // q2, column B, repeat 2
    expect(last.source).toEqual({ db: "/data/x.duckdb" });
    expect(last.labels).toMatchObject({ question: "q2", column: "B", repeat: 2 });
  });
});

describe("numbers", () => {
  it("median and spread", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(spread([0.009, 0.01, 0.011])).toBeCloseTo(0.1);
    expect(spread([0.01])).toBeNull();
  });

  it("lamps by status", () => {
    let state = started();
    state = finish(state, 0);
    state = finish(state, 1, result({ status: "max_iterations" }));
    state = setlistReducer(state, { type: "jobStarted", index: 2 });
    state = setlistReducer(state, { type: "jobFailed", index: 2, error: "boom", at: 1 });
    state = finish(state, 3, result({ status: "api_error" }));
    expect(state.jobs.slice(0, 5).map(lampOf)).toEqual(["ok", "limit", "error", "error", "queue"]);
  });

  it("a cell's medians and spread come from its finished repeats", () => {
    let state = started();
    state = finish(state, 0, result({ estimated_cost_usd: 0.02, iterations: 6 })); // q1 A #1
    state = finish(state, 2, result({ estimated_cost_usd: 0.04, iterations: 8 })); // q1 A #2
    const stats = cellStats(cellJobs(state, "q1", 0));
    expect(stats.lamps).toEqual(["ok", "ok"]);
    expect(stats.medCost).toBeCloseTo(0.03);
    expect(stats.medIterations).toBe(7);
    expect(stats.spread).toBeCloseTo(1 / 3);
  });

  it("a column's summary, and the projected total", () => {
    let state = started();
    state = finish(state, 0, result({ estimated_cost_usd: 0.02 }));
    state = finish(state, 2, result({ estimated_cost_usd: 0.02, status: "max_iterations" }));
    const a = columnSummary(state, 0);
    expect(a).toMatchObject({ total: 4, completed: 1, limits: 1, errors: 0 });
    expect(a.totalCost).toBeCloseTo(0.04);
    // Column B hasn't finished a run, so there's nothing to project from yet.
    expect(progressOf(state).projected).toBeNull();
    state = finish(state, 1, result({ estimated_cost_usd: 0.1 }));
    const p = progressOf(state);
    expect(p).toMatchObject({ total: 8, settled: 3, running: 0 });
    expect(p.spent).toBeCloseTo(0.14);
    // 2 more A runs at 0.02, 3 more B runs at 0.10
    expect(p.projected).toBeCloseTo(0.14 + 2 * 0.02 + 3 * 0.1);
  });
});

describe("the built-in set in a setlist", () => {
  it("22 questions × 3 presets × 3 repeats is 198 runs", () => {
    expect(planJobs({ name: "x", set: FACTORY_QUESTION_SETS[0], columns: FACTORY_PRESETS, repeats: 3, concurrency: 3 })).toHaveLength(198);
  });
});

describe("naming a setlist", () => {
  it("builds the on-screen title from the facts, with your name after them", () => {
    const at = new Date(2026, 10, 2, 14, 5);
    expect(setlistTitle({ set, columns: [quick, balanced], repeats: 3 }, at)).toBe("Mini · 2 presets × 3 · Nov 2, 14:05");
    expect(setlistTitle({ set, columns: [quick], repeats: 1, name: "after compressor change" }, new Date(2026, 0, 9, 9, 0)))
      .toBe("Mini · 1 preset × 1 · Jan 9, 09:00 — after compressor change");
  });

  it("stores only your words: no name, no setlist_name label", () => {
    const state = setlistReducer(SETLIST_IDLE, { type: "start", plan: { ...plan, name: undefined, note: undefined }, runId: "sl-3", at: 0 });
    const labels = jobRequest(DEFAULT_SETTINGS, state, state.jobs[0]).labels!;
    expect("setlist_name" in labels).toBe(false);
    expect(labels.setlist).toBe("mini");
    expect(labels.setlist_run).toBe("sl-3");
  });

  it("keeps names to one tidy line within the label limit", () => {
    expect(cleanName("  After   compressor\nchange ", 80)).toBe("After compressor change");
    expect(cleanName("x".repeat(300), 80)).toHaveLength(80);
  });

  it("leaves the note out of the labels when there isn't one", () => {
    const state = setlistReducer(SETLIST_IDLE, { type: "start", plan: { ...plan, note: undefined }, runId: "sl-2", at: 0 });
    const labels = jobRequest(DEFAULT_SETTINGS, state, state.jobs[0]).labels!;
    expect(labels.setlist_name).toBe("Effort check");
    expect("setlist_note" in labels).toBe(false);
  });
});

describe("setlist IDs", () => {
  it("are the start date and time plus 4 random characters, so they sort and never collide", () => {
    let i = 0;
    const id = newSetlistRunId(new Date(2026, 10, 2, 14, 5), () => [0, 0.5, 0.99, 0.25][i++ % 4]);
    expect(id).toBe("sl-2026-11-02-1405-as9i");
    expect(newSetlistRunId()).toMatch(/^sl-\d{4}-\d{2}-\d{2}-\d{4}-[a-z2-9]{4}$/);
    const many = new Set(Array.from({ length: 200 }, () => newSetlistRunId(new Date(2026, 10, 2, 14, 5))));
    expect(many.size).toBeGreaterThan(195);
  });
});
