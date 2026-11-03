import { describe, expect, it } from "vitest";
import { parseQuestionSet, questionSetToFile, type QuestionSet } from "@dh/formats";
import type { RunGrade } from "../engine";
import {
  addQuickCheckQuestion, cleanQuickCheck, currentGrade, gradeTag, matchQuestion, newQuickSet, nextQuestionId, runTag, sameData,
  sameQuickCheck,
} from "../runs";

const tpch: QuestionSet = {
  id: "tpch", name: "TPC-H", description: "", revision: 2, savedAt: "", categories: [],
  source: { kind: "tpch", tpchScale: 0.01 },
  questions: [
    { id: "q1", title: "Pricing", prompt: "Summarize pricing  by status.", tags: [] },
    { id: "q8", title: "Market share", prompt: "What is BRAZIL's share?", tags: [], check: { correct: "Says 3.9%." } },
  ],
};
const old: QuestionSet = { ...tpch, revision: 1 };

const grade = (over: Partial<RunGrade>): RunGrade => ({
  run_id: "r", grader_key: "k", graded_at: "2026-11-03T14:00:00", question_set: "tpch", question_set_revision: 2, question: "q8",
  grader: null, quick_check: null, status: "completed", correct: 2, careful: 1, efficient: 2, correct_reason: null,
  careful_reason: null, efficient_reason: null, judge_unsure: false, judge_values: null, rules: null, rules_passed: null,
  judge_model: null, judge_cost_usd: 0.001, judge_error: null, override: null, run_cost_usd: null, reference: null, ...over,
});

describe("RUN mode", () => {
  it("matches a run to its question: setlist labels first, then the same prompt", () => {
    const setlistRun = { prompt: "anything", labels: { setlist: "tpch", question: "q8", setlist_revision: 1 } };
    const m = matchQuestion(setlistRun, [tpch, old]);
    expect([m?.how, m?.question.id, m?.set.revision]).toEqual(["setlist", "q8", 1]);
    const byPrompt = matchQuestion({ prompt: "  summarize PRICING by status. ", labels: {} }, [tpch]);
    expect([byPrompt?.how, byPrompt?.question.id]).toEqual(["prompt", "q1"]);
    expect(matchQuestion({ prompt: "Who spent the most?", labels: {} }, [tpch])).toBeNull();
  });

  it("says when a run used other data than its question", () => {
    expect(sameData({ source: { kind: "tpch", tpchScale: 0.01 } }, tpch, tpch.questions[0])).toBe(true);
    expect(sameData({ source: { kind: "tpch", tpchScale: 1 } }, tpch, tpch.questions[0])).toBe(false);
    expect(sameData({ source: null }, tpch, tpch.questions[0])).toBeNull();
  });

  it("tags runs in the list", () => {
    expect(runTag({ preset: "Balanced", preset_modified: true, labels: { ab: "B", pair: "ab-1" } })).toBe("Balanced (edited) · A/B B");
    expect(runTag({ preset: "Deep Dive", preset_modified: false, labels: { setlist_run: "sl", question: "q8", column: "C", repeat: 1 } }))
      .toBe("Deep Dive · q8 · C#1");
    expect(gradeTag({ grade: null, status: "completed" })).toBe("NOT GRADED");
    expect(gradeTag({ grade: null, status: "max_iterations" })).toBe("MAX ITERATIONS");
    expect(gradeTag({ grade: { question_set: "quick", question: null, total: 5, rules_passed: null }, status: "completed" })).toBe("5/6 · QUICK");
    expect(gradeTag({ grade: { question_set: "tpch", question: "q8", total: 6, rules_passed: false }, status: "completed" })).toBe("RULE ✕");
  });

  it("shows the newest grade for the question, or the newest quick check", () => {
    const grades = [grade({ question_set: "quick", question: null, grader_key: "quick" }), grade({ grader_key: "set" })];
    expect(currentGrade(grades, { set: tpch, question: tpch.questions[1] })?.grader_key).toBe("set");
    expect(currentGrade(grades, "quick")?.grader_key).toBe("quick");
    expect(currentGrade(grades, { set: tpch, question: tpch.questions[0] })).toBeNull();
  });

  it("cleans a quick check and knows when it changed", () => {
    const check = cleanQuickCheck({ correct: " 100 users ", careful: "  ", sql: "SELECT 1\n" });
    expect(check).toEqual({ correct: "100 users", sql: ["SELECT 1"] });
    const g = grade({ quick_check: { correct: "100 users", sql: ["SELECT 1"], source: null } });
    expect(sameQuickCheck(g, check)).toBe(true);
    expect(sameQuickCheck(g, { ...check, careful: "Say it's distinct users" })).toBe(false);
  });

  it("saves a quick check as the next question in a set, as a new revision that reads back", () => {
    const run = { prompt: "Which 5 customers spent the most in 1997?", source: { kind: "tpch" as const, tpchScale: 0.1 } };
    const { set, question } = addQuickCheckQuestion(tpch, run, { correct: "The top 5", sql: ["SELECT 1"] }, { title: "Top customers" });
    expect([set.revision, question.id, question.title]).toEqual([3, "QC1", "Top customers"]);
    // The run's data differs from the set's (0.1 vs 0.01): the question keeps the run's.
    expect(question.source).toEqual({ kind: "tpch", tpchScale: 0.1 });
    expect(parseQuestionSet(questionSetToFile(set)).questions.slice(-1)[0]?.check?.sql).toEqual(["SELECT 1"]);
    expect(nextQuestionId(set)).toBe("QC2");

    const fresh = addQuickCheckQuestion(newQuickSet(), run, { correct: "x" }, { title: "" });
    expect([fresh.set.revision, fresh.set.id, fresh.question.title]).toEqual([1, "quick-checks", run.prompt.slice(0, 60)]);
    expect(parseQuestionSet(questionSetToFile(fresh.set)).name).toBe("Quick checks");
  });
});
