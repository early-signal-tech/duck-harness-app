// The scorecard: a setlist's grades laid out as questions (grouped by category) × preset
// columns, each cell averaging its repeats' CORRECT, CAREFUL, and EFFICIENT (0-2), plus
// summaries per column. Pure functions; Eh1.tsx draws them.

import { questionGroups, type Category, type Question, type QuestionSet } from "@dh/formats";
import type { Grade, GraderSettings, SetlistInfo } from "./engine";

export const COLUMN_KEYS = ["A", "B", "C", "D"] as const;

export function avg(values: (number | null | undefined)[]): number | null {
  const xs = values.filter((v): v is number => typeof v === "number");
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** A run's total out of 6, when the judge scored it. */
export function total(g: Grade): number | null {
  return g.correct === null || g.careful === null || g.efficient === null ? null : g.correct + g.careful + g.efficient;
}

export interface Cell {
  grades: Grade[];
  correct: number | null;
  careful: number | null;
  efficient: number | null;
  total: number | null;
  rulesBroken: number;
  judgeErrors: number;
  unsure: number;
}

export function cellOf(grades: Grade[]): Cell {
  const sorted = [...grades].sort((a, b) => (a.repeat ?? 0) - (b.repeat ?? 0));
  return {
    grades: sorted,
    correct: avg(sorted.map((g) => g.correct)),
    careful: avg(sorted.map((g) => g.careful)),
    efficient: avg(sorted.map((g) => g.efficient)),
    total: avg(sorted.map(total)),
    rulesBroken: sorted.filter((g) => g.rules_passed === false).length,
    judgeErrors: sorted.filter((g) => g.judge_error).length,
    unsure: sorted.filter((g) => g.judge_unsure).length,
  };
}

export interface Row {
  question: Question;
  cells: Cell[];
}

export interface Group {
  category?: Category;
  rows: Row[];
  /** The category's averages per column. */
  cells: Cell[];
}

/** The columns a setlist ran (A, B, …), from its size or, failing that, its grades. */
export function columnsOf(setlist: SetlistInfo | null, grades: Grade[]): string[] {
  const n = Math.max(setlist?.columns ?? 0, ...grades.map((g) => COLUMN_KEYS.indexOf((g.column ?? "") as never) + 1));
  return COLUMN_KEYS.slice(0, Math.max(1, n));
}

export function scorecard(set: QuestionSet, grades: Grade[], columns: string[]): Group[] {
  const by = new Map<string, Grade[]>();
  for (const g of grades) {
    const key = `${g.question}|${g.column}`;
    by.set(key, [...(by.get(key) ?? []), g]);
  }
  return questionGroups(set).map((group) => {
    const rows = group.questions.map((question) => ({
      question,
      cells: columns.map((c) => cellOf(by.get(`${question.id}|${c}`) ?? [])),
    }));
    const cells = columns.map((_, i) => cellOf(rows.flatMap((r) => r.cells[i].grades)));
    return { ...(group.category ? { category: group.category } : {}), rows, cells };
  });
}

export interface ColumnSummary {
  graded: number;
  total: number | null;
  fullMarks: number;
  /** What the column's runs cost per answer that scored 6/6. */
  costPerFullMarks: number | null;
  rulesBroken: number;
  judgeCost: number;
}

export function columnSummary(grades: Grade[], column: string): ColumnSummary {
  const gs = grades.filter((g) => g.column === column);
  const fullMarks = gs.filter((g) => total(g) === 6).length;
  const runCost = gs.reduce((sum, g) => sum + (g.run_cost_usd ?? 0), 0);
  return {
    graded: gs.length,
    total: avg(gs.map(total)),
    fullMarks,
    costPerFullMarks: fullMarks ? runCost / fullMarks : null,
    rulesBroken: gs.filter((g) => g.rules_passed === false).length,
    judgeCost: gs.reduce((sum, g) => sum + (g.judge_cost_usd ?? 0), 0),
  };
}

/** The question set a setlist ran: same id, and the same revision when it's known. */
export function findSet(sets: QuestionSet[], setlist: SetlistInfo | null): { set: QuestionSet | null; revisionMismatch: boolean } {
  if (!setlist) return { set: null, revisionMismatch: false };
  const same = sets.filter((s) => s.id === setlist.question_set);
  const exact = same.find((s) => setlist.revision == null || s.revision === setlist.revision);
  if (exact) return { set: exact, revisionMismatch: false };
  return { set: same[0] ?? null, revisionMismatch: same.length > 0 };
}

// --- the grader settings the face remembers ---

export const JUDGE_MODELS = [
  { id: "claude-haiku-5-5", label: "HAIKU" },
  { id: "claude-sonnet-5-5", label: "SONNET" },
  { id: "claude-opus-5-5", label: "OPUS" },
] as const;
export const JUDGE_EFFORTS = ["low", "medium", "high"] as const;
export const TOLERANCES = ["±0.1%", "±0.5%", "±1%", "±5%"] as const;

export const DEFAULT_GRADER: GraderSettings = {
  name: "Standard rubric",
  revision: 1,
  judge_model: "claude-sonnet-5-5",
  judge_effort: "low",
  tolerance: "±0.5%",
  iteration_budget: 8,
};

const GRADER_KEY = "eh1.grader";

export function loadGrader(): GraderSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(GRADER_KEY) ?? "null");
    if (saved && typeof saved === "object") return { ...DEFAULT_GRADER, ...saved };
  } catch {
    // Unreadable or blocked storage: the defaults.
  }
  return DEFAULT_GRADER;
}

export function saveGrader(grader: GraderSettings): void {
  try {
    localStorage.setItem(GRADER_KEY, JSON.stringify(grader));
  } catch {
    // Not worth interrupting anyone over.
  }
}
