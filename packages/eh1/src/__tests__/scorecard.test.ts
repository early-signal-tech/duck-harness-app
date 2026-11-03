import { describe, expect, it } from "vitest";
import type { QuestionSet } from "@dh/formats";
import type { Grade, SetlistInfo } from "../engine";
import { cellOf, columnsOf, columnSummary, findSet, scorecard, total } from "../scorecard";
import { setlistTitle } from "../Eh1";

const set: QuestionSet = {
  id: "eval", name: "Eval", description: "", revision: 2, savedAt: "",
  categories: [{ id: "A", name: "Basics" }, { id: "B", name: "More" }],
  source: { kind: "tpch", tpchScale: 0.01 },
  questions: [
    { id: "A1", title: "One", prompt: "p", tags: [], category: "A" },
    { id: "B1", title: "Two", prompt: "p", tags: [], category: "B" },
    { id: "A2", title: "Three", prompt: "p", tags: [], category: "A" },
  ],
};

const g = (question: string, column: string, repeat: number, scores: [number | null, number | null, number], extra: Partial<Grade> = {}): Grade => ({
  run_id: `${question}-${column}-${repeat}`, question, column, repeat, status: "completed",
  correct: scores[0], careful: scores[1], efficient: scores[2],
  correct_reason: null, careful_reason: null, efficient_reason: null, judge_unsure: false, judge_values: null,
  rules: null, rules_passed: null, judge_cost_usd: 0.001, judge_error: null, override: null, run_cost_usd: 0.002, ...extra,
});

const setlist = (over: Partial<SetlistInfo> = {}): SetlistInfo => ({
  id: "sl-1", question_set: "eval", revision: 2, name: null, note: null, concurrency: 1, runs: 6, completed: 6,
  columns: 2, repeats: 1, cost_usd: 0.01, started_at: "2026-11-02T18:19:00", ended_at: null, ...over,
});

describe("the scorecard", () => {
  const grades = [
    g("A1", "A", 1, [2, 2, 2]), g("A1", "A", 2, [1, 1, 2], { rules_passed: false }),
    g("A1", "B", 1, [2, 1, 2]), g("B1", "A", 1, [null, null, 1], { judge_error: "judge stopped: refusal" }),
  ];

  it("averages repeats per cell and counts broken rules and judge errors", () => {
    const cell = cellOf(grades.filter((x) => x.question === "A1" && x.column === "A"));
    expect([cell.correct, cell.careful, cell.efficient, cell.total]).toEqual([1.5, 1.5, 2, 5]);
    expect(cell.rulesBroken).toBe(1);
    expect(cellOf([grades[3]]).judgeErrors).toBe(1);
    expect(total(grades[3])).toBeNull();
  });

  it("groups questions by category in the set's order, with category averages", () => {
    const groups = scorecard(set, grades, ["A", "B"]);
    expect(groups.map((gr) => [gr.category?.id, gr.rows.map((r) => r.question.id)])).toEqual([["A", ["A1", "A2"]], ["B", ["B1"]]]);
    expect(groups[0].cells[0].total).toBe(5);
    expect(groups[0].rows[1].cells[0].grades).toEqual([]);
  });

  it("sums up each column: average, full marks, and cost per full-marks answer", () => {
    const a = columnSummary(grades, "A");
    expect(a.graded).toBe(3);
    expect(a.fullMarks).toBe(1);
    expect(a.costPerFullMarks).toBeCloseTo(0.006);
    expect(a.rulesBroken).toBe(1);
    expect(columnSummary(grades, "B").costPerFullMarks).toBeNull();
  });

  it("knows the setlist's columns", () => {
    expect(columnsOf(setlist({ columns: 3 }), [])).toEqual(["A", "B", "C"]);
    expect(columnsOf(null, [g("A1", "B", 1, [2, 2, 2])])).toEqual(["A", "B"]);
  });
});

describe("finding a setlist's question set and naming it", () => {
  it("matches by id and revision, and flags a changed set", () => {
    expect(findSet([set], setlist()).set?.id).toBe("eval");
    expect(findSet([set], setlist({ revision: 1 }))).toEqual({ set, revisionMismatch: true });
    expect(findSet([set], setlist({ question_set: "other" })).set).toBeNull();
  });

  it("uses the name, or builds a title from the facts", () => {
    expect(setlistTitle(setlist({ name: "Compressor test" }))).toBe("Compressor test");
    expect(setlistTitle(setlist(), "Eval")).toBe("Eval · 2 presets × 1 · Nov 2, 18:19");
  });
});
