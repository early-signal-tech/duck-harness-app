// RUN mode's logic: which question a run answered, what the RUNS list says about each
// run, which grade to show, and turning a quick check into a question for a set. Pure
// functions; RunView.tsx draws them.

import { sameSource, type Question, type QuestionSet, type SourceSpec } from "@dh/formats";
import type { QuickCheck, RunDetail, RunGrade, RunSummary } from "./engine";

export interface Match {
  set: QuestionSet;
  question: Question;
  /** "setlist": the run's labels name it; "prompt": the same prompt is in a set;
   *  "picked": you chose it. */
  how: "setlist" | "prompt" | "picked";
}

const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** The question a run answered: the one a setlist labelled it with, else a question with
 *  the same prompt (the first set that has one). */
export function matchQuestion(run: Pick<RunDetail, "prompt" | "labels">, sets: QuestionSet[]): Match | null {
  const setId = run.labels.setlist;
  const questionId = run.labels.question;
  if (typeof setId === "string" && typeof questionId === "string") {
    const same = sets.filter((s) => s.id === setId);
    const set = same.find((s) => s.revision === run.labels.setlist_revision) ?? same[0];
    const question = set?.questions.find((q) => q.id === questionId);
    if (set && question) return { set, question, how: "setlist" };
  }
  const prompt = norm(run.prompt);
  for (const set of sets) {
    const question = set.questions.find((q) => norm(q.prompt) === prompt);
    if (question) return { set, question, how: "prompt" };
  }
  return null;
}

/** The data a question runs on: its own source, else its set's. */
export function questionSourceOf(set: QuestionSet, question: Question): SourceSpec | undefined {
  return question.source ?? set.source;
}

/** Whether the run used the question's data (unknown when either doesn't say). */
export function sameData(run: Pick<RunDetail, "source">, set: QuestionSet, question: Question): boolean | null {
  const q = questionSourceOf(set, question);
  if (!run.source || !q) return null;
  return sameSource(normalizeSource(run.source), normalizeSource(q));
}

/** Sources compare without a "main" schema (it's the default). */
function normalizeSource(s: SourceSpec): SourceSpec {
  return s.kind === "db" && (!s.schema || s.schema === "main") ? { kind: "db", dbPath: s.dbPath } : s;
}

// --- the RUNS list ---

export const RUN_KINDS = [["all", "ALL"], ["single", "SINGLE"], ["ab", "A/B"], ["setlist", "SETLIST"]] as const;

export function runWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "Balanced (edited) · A/B" or "Deep Dive · q8 · C#1": the preset and what kind of run. */
export function runTag(r: Pick<RunSummary, "preset" | "preset_modified" | "labels">): string {
  const parts = [r.preset ? `${r.preset}${r.preset_modified ? " (edited)" : ""}` : "No preset"];
  if (r.labels.pair) parts.push(`A/B ${r.labels.ab ?? ""}`.trim());
  if (r.labels.setlist_run) parts.push(`${r.labels.question ?? "?"} · ${r.labels.column ?? ""}#${r.labels.repeat ?? 1}`);
  return parts.join(" · ");
}

/** What the RUNS list says about a run's newest grade. */
export function gradeTag(r: Pick<RunSummary, "grade" | "status">): string {
  if (!r.grade) return r.status === "completed" ? "NOT GRADED" : r.status.replace(/_/g, " ").toUpperCase();
  if (r.grade.rules_passed === false) return "RULE ✕";
  const total = r.grade.total === null ? "GRADED" : `${r.grade.total}/6`;
  return r.grade.question_set === "quick" ? `${total} · QUICK` : total;
}

// --- which grade to show ---

/** The newest grade against this question (any grader settings), or the newest quick check. */
export function currentGrade(grades: RunGrade[], target: { set: QuestionSet; question: Question } | "quick"): RunGrade | null {
  const found = grades.find((g) =>
    target === "quick" ? g.question_set === "quick" : g.question_set === target.set.id && g.question === target.question.id);
  return found ?? null;
}

export function totalOf(g: RunGrade): number | null {
  const c = g.override ? g.override.correct : g.correct;
  const k = g.override ? g.override.careful : g.careful;
  return c === null || k === null || g.efficient === null ? null : c + k + g.efficient;
}

/** A quick check as you typed it: blank fields left out, reference SQL as one query. */
export function cleanQuickCheck(form: { correct: string; careful: string; sql: string }): QuickCheck {
  const sql = form.sql.trim();
  const careful = form.careful.trim();
  return { correct: form.correct.trim(), ...(careful ? { careful } : {}), ...(sql ? { sql: [sql] } : {}) };
}

/** Whether a grade was made with this quick check (an edit means it needs grading again). */
export function sameQuickCheck(g: RunGrade, check: QuickCheck): boolean {
  if (!g.quick_check) return false;
  const { source: _source, ...was } = g.quick_check;
  return JSON.stringify(cleanQuickCheck({ correct: was.correct ?? "", careful: was.careful ?? "", sql: (was.sql ?? []).join("\n") }))
    === JSON.stringify(check);
}

// --- saving a quick check as a question ---

export const QUICK_SET_ID = "quick-checks";

/** A new MINE set for quick checks you keep. */
export function newQuickSet(now = new Date()): QuestionSet {
  return {
    id: QUICK_SET_ID, name: "Quick checks", description: "Questions saved from EH-1's quick checks.",
    revision: 0, savedAt: now.toISOString(), categories: [], questions: [],
  };
}

/** The next free id like QC1, QC2, … in a set. */
export function nextQuestionId(set: QuestionSet, prefix = "QC"): string {
  const used = new Set(set.questions.map((q) => q.id));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

/** The set with the run's prompt and your quick check added as a question (revision + 1).
 *  The question keeps the run's data when the set's is different (or the set has none). */
export function addQuickCheckQuestion(set: QuestionSet, run: Pick<RunDetail, "prompt" | "source">, check: QuickCheck,
  options: { title: string; category?: string }, now = new Date()): { set: QuestionSet; question: Question } {
  if (!run.source && !set.source) {
    // Every question needs data to run on: its own, or its set's.
    throw new Error(`This run didn't record its data, and ${set.name} has no data of its own, so the question would have nothing to run on. Save it to a set with data instead.`);
  }
  const question: Question = {
    id: nextQuestionId(set),
    title: options.title.replace(/\s+/g, " ").trim() || run.prompt.slice(0, 60),
    prompt: run.prompt,
    tags: [],
    ...(options.category ? { category: options.category } : {}),
    ...(run.source && (!set.source || !sameSource(normalizeSource(set.source), normalizeSource(run.source))) ? { source: run.source } : {}),
    check: { correct: check.correct, ...(check.careful ? { careful: check.careful } : {}), ...(check.sql?.length ? { sql: check.sql } : {}) },
  };
  return {
    set: { ...set, revision: set.revision + 1, savedAt: now.toISOString(), questions: [...set.questions, question] },
    question,
  };
}
