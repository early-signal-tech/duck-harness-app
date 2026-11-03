// Getting grades out of EH-1: the scorecard as CSV (one row per graded run), and the SQL
// that reads the same grades in the DuckDB shell. Pure functions; Eh1.tsx saves and opens.

import type { QuestionSet } from "@dh/formats";
import type { Grade, SetlistInfo } from "./engine";
import { carefulOf, correctOf, total } from "./scorecard";

const COLUMNS = [
  "setlist_run", "question_set", "revision", "category", "question", "title", "column", "preset", "repeat", "run_id",
  "status", "correct", "careful", "efficient", "total", "overridden", "judge_correct", "judge_careful", "override_why",
  "rules_passed", "rules_broken", "judge_unsure", "judge_error", "correct_reason", "careful_reason", "efficient_reason",
  "judge_cost_usd", "run_cost_usd",
] as const;

/** A CSV field: quoted when it has a comma, quote, or line break (RFC 4180). */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The scorecard as CSV, in scorecard order (category, question, column, repeat).
 *  correct and careful are the scores that count (your override where you set one); the
 *  judge's are beside them. */
export function gradesCsv(setlist: SetlistInfo, set: QuestionSet, grades: Grade[]): string {
  const order = new Map(set.questions.map((q, i) => [q.id, i]));
  const categoryOrder = new Map(set.categories.map((c, i) => [c.id, i]));
  const question = new Map(set.questions.map((q) => [q.id, q]));
  const preset = new Map((setlist.presets ?? []).map((p) => [p.column, `${p.name ?? ""}${p.modified ? " (edited)" : ""}`]));
  const rank = (g: Grade) => {
    const q = question.get(g.question);
    return [categoryOrder.get(q?.category ?? "") ?? 999, order.get(g.question) ?? 999];
  };
  const sorted = [...grades].sort((a, b) => {
    const [ca, qa] = rank(a);
    const [cb, qb] = rank(b);
    return ca - cb || qa - qb || (a.column ?? "").localeCompare(b.column ?? "") || (a.repeat ?? 0) - (b.repeat ?? 0);
  });
  const rows = sorted.map((g) => {
    const q = question.get(g.question);
    const row: Record<(typeof COLUMNS)[number], unknown> = {
      setlist_run: setlist.id, question_set: set.id, revision: set.revision, category: q?.category ?? "", question: g.question,
      title: q?.title ?? "", column: g.column, preset: preset.get(g.column ?? "") ?? "", repeat: g.repeat, run_id: g.run_id,
      status: g.status, correct: correctOf(g), careful: carefulOf(g), efficient: g.efficient, total: total(g),
      overridden: g.override ? "yes" : "", judge_correct: g.correct, judge_careful: g.careful, override_why: g.override?.why ?? "",
      rules_passed: g.rules_passed === null ? "" : g.rules_passed,
      rules_broken: (g.rules ?? []).filter((r) => !r.passed).map((r) => r.label).join("; "),
      judge_unsure: g.judge_unsure ? "yes" : "", judge_error: g.judge_error ?? "",
      correct_reason: g.correct_reason, careful_reason: g.careful_reason, efficient_reason: g.efficient_reason,
      judge_cost_usd: g.judge_cost_usd, run_cost_usd: g.run_cost_usd,
    };
    return COLUMNS.map((c) => csvField(row[c])).join(",");
  });
  return [COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

/** A file name for a setlist's CSV: its ID and the date it was saved. */
export function csvFileName(setlist: SetlistInfo, now = new Date()): string {
  return `${setlist.id}-grades-${now.toISOString().slice(0, 10)}.csv`;
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The SQL that shows this scorecard's grades in the DuckDB shell (on the traces). */
export function gradesSql(setlistRun: string, graderKey: string): string {
  return `-- EH-1: the grades of setlist ${setlistRun} (grader ${graderKey})
SELECT g.question,
       r.labels."column"::VARCHAR AS col,
       r.labels."repeat"::INTEGER AS rep,
       coalesce(g.override.correct::INTEGER, g.correct) AS correct,
       coalesce(g.override.careful::INTEGER, g.careful) AS careful,
       g.efficient,
       g.override IS NOT NULL AS overridden,
       g.rules_passed,
       g.correct_reason
FROM eval_grades g JOIN agent_runs r USING (run_id)
WHERE g.setlist_run = ${quote(setlistRun)} AND g.grader_key = ${quote(graderKey)}
ORDER BY g.question, col, rep;`;
}
