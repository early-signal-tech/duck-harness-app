// Question sets: a list of questions to ask an agent, each with the data it runs on and,
// optionally, how to check its answer. DH-1's Setlist runs them (questions × presets ×
// repeats); EH-1 grades the runs: CORRECT, CAREFUL, and EFFICIENT (0–2 each) plus trace
// rules. The format is described for people (and the Python side) in
// docs/QUESTION_SETS.md. Version 2 adds categories, schema and tables, several reference
// queries, written criteria, and trace rules; version 1 files are still read.

import { parseSource, type SourceSpec } from "./source";

export const QUESTION_SET_FORMAT = "dh-question-set";
export const QUESTION_SET_FORMAT_VERSION = 2;

/** A pass/fail check on what a run did, read from its traces (no judge). */
export type TraceRule =
  /** A tool call failed with this error_type ("present"), or none did ("absent"). */
  | { error: string; expect: "present" | "absent"; label?: string }
  /** The tool was called at least `min` and at most `max` times. */
  | { tool: string; min?: number; max?: number; label?: string }
  /** The first call to `before` came before the first call to `after`. */
  | { before: string; after: string; label?: string }
  /** A query matched the pattern (case-insensitive regex), or none did; at most `max` matched. */
  | { sql: string; expect: "present" | "absent"; max?: number; label?: string }
  /** The run took at most this many iterations. */
  | { iterations: { max: number }; label?: string }
  /** At most this many query_database calls. */
  | { queries: { max: number }; label?: string };

/** How to tell whether an answer is right. Every field is optional, but a check has at
 *  least one. DH-1 only shows whether a question has a check; EH-1 uses it. */
export interface QuestionCheck {
  /** Reference SQL: run on the run's own data; the judge sees the results. */
  sql?: string[];
  /** A TPC-H query number (1–22): compare with DuckDB's published answers (tpch_answers()),
   *  which exist for scale factors 0.01, 0.1, and 1. */
  tpchQuery?: number;
  /** Facts the answer should contain. */
  reference?: string;
  /** What a right answer does (the CORRECT score). Version 1's `expect` reads as this. */
  correct?: string;
  /** The assumptions and caveats it should state (the CAREFUL score). */
  careful?: string;
  /** What caps the score at 0. */
  fail?: string;
  /** Extra credit: can lift CAREFUL to 2, never CORRECT. */
  bonus?: string;
  rules?: TraceRule[];
  /** For people (shown to the judge too), e.g. a known gap. */
  note?: string;
}

export interface Category {
  /** Short and stable, e.g. "A". */
  id: string;
  name: string;
}

export interface Question {
  /** Unique within the set, and stable: runs are labelled with it. */
  id: string;
  title: string;
  /** What's sent to the agent. */
  prompt: string;
  tags: string[];
  /** One of the set's categories, when it has them. */
  category?: string;
  /** Overrides the set's source for this question. */
  source?: SourceSpec;
  /** Overrides the set's tables: [] means preload none (the agent finds them). */
  tables?: string[];
  check?: QuestionCheck;
}

export interface QuestionSet {
  /** Stable: runs are labelled with it. */
  id: string;
  name: string;
  description: string;
  /** Goes up by one on every change, so runs can tell versions of a set apart. */
  revision: number;
  savedAt: string;
  /** The source every question runs on, unless it has its own. */
  source?: SourceSpec;
  /** Tables whose schema is preloaded for the agent, unless a question says otherwise. */
  tables?: string[];
  /** In scorecard order. */
  categories: Category[];
  questions: Question[];
  /** Built in, read-only. */
  factory?: boolean;
}

export class QuestionSetError extends Error {}

const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const TABLE = /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/;

/** The source a question runs on: its own, or the set's. */
export function questionSource(set: QuestionSet, question: Question): SourceSpec | undefined {
  return question.source ?? set.source;
}

/** The questions in scorecard order: by category, in the set's category order, then any
 *  without one. A set without categories is one group. */
export function questionGroups(set: QuestionSet): { category?: Category; questions: Question[] }[] {
  if (!set.categories.length) return [{ questions: set.questions }];
  const groups: { category?: Category; questions: Question[] }[] = set.categories
    .map((category) => ({ category, questions: set.questions.filter((q) => q.category === category.id) }))
    .filter((g) => g.questions.length);
  const loose = set.questions.filter((q) => !q.category);
  return loose.length ? [...groups, { questions: loose }] : groups;
}

/** The tables to preload for a question: its own, or the set's; undefined means none. */
export function questionTables(set: QuestionSet, question: Question): string[] | undefined {
  return question.tables ?? set.tables;
}

export function hasCheck(question: Question): boolean {
  const c = question.check;
  return !!c && Object.values(c).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== ""));
}

/** A rule as people read it: its label, or a description made from its fields. */
export function describeRule(rule: TraceRule): string {
  if (rule.label) return rule.label;
  if ("error" in rule) return `${rule.expect === "present" ? "has" : "no"} ${rule.error} errors`;
  if ("tool" in rule) {
    const n = rule.min !== undefined && rule.max !== undefined ? `${rule.min}–${rule.max}×`
      : rule.min !== undefined ? `at least ${rule.min}×` : rule.max !== undefined ? `at most ${rule.max}×` : "";
    return `calls ${rule.tool}${n ? ` ${n}` : ""}`;
  }
  if ("before" in rule) return `${rule.before} before ${rule.after}`;
  if ("sql" in rule) return `${rule.expect === "present" ? "a query matches" : "no query matches"} /${rule.sql}/`;
  if ("iterations" in rule) return `at most ${rule.iterations.max} iterations`;
  return `at most ${rule.queries.max} queries`;
}

export function questionSetToFile(set: QuestionSet): string {
  const { factory: _factory, categories, ...rest } = set;
  return JSON.stringify(
    {
      format: QUESTION_SET_FORMAT,
      formatVersion: QUESTION_SET_FORMAT_VERSION,
      ...rest,
      ...(categories.length ? { categories } : {}),
    },
    null,
    2,
  ) + "\n";
}

// --- reading ---

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const isCount = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;

function fail(message: string): never {
  throw new QuestionSetError(message);
}

/** A regex as the rules use it: case-insensitive, (?i) allowed (JavaScript has no inline flags). */
export function ruleRegex(pattern: string): RegExp {
  return new RegExp(pattern.replace(/^\(\?i\)/, ""), "i");
}

function parseTables(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || !value.every((t) => typeof t === "string" && TABLE.test(t.trim()))) {
    fail(`${where}: "tables" should be a list of table names ([] for none).`);
  }
  return (value as string[]).map((t) => t.trim());
}

function parseRule(value: unknown, where: string): TraceRule {
  const r = (value ?? {}) as Record<string, unknown>;
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${where}: a rule should be an object.`);
  const label = text(r.label) ? { label: text(r.label) } : {};
  const expect = (v: unknown) => {
    if (v !== "present" && v !== "absent") fail(`${where}: "expect" should be "present" or "absent".`);
    return v as "present" | "absent";
  };
  const limit = (v: unknown, name: string) => {
    const m = (v ?? {}) as Record<string, unknown>;
    if (!isCount(m.max)) fail(`${where}: "${name}" should be {"max": a number}.`);
    return { max: m.max as number };
  };
  if ("error" in r) {
    if (!text(r.error)) fail(`${where}: "error" should name an error type, e.g. "read_only_violation".`);
    return { error: text(r.error), expect: expect(r.expect), ...label };
  }
  if ("tool" in r) {
    if (!text(r.tool)) fail(`${where}: "tool" should name a tool, e.g. "list_tables".`);
    if (r.min !== undefined && !isCount(r.min)) fail(`${where}: "min" should be a whole number.`);
    if (r.max !== undefined && !isCount(r.max)) fail(`${where}: "max" should be a whole number.`);
    return {
      tool: text(r.tool),
      ...(r.min !== undefined ? { min: r.min as number } : {}),
      ...(r.max !== undefined ? { max: r.max as number } : {}),
      ...label,
    };
  }
  if ("before" in r || "after" in r) {
    if (!text(r.before) || !text(r.after)) fail(`${where}: an order rule needs "before" and "after" tool names.`);
    return { before: text(r.before), after: text(r.after), ...label };
  }
  if ("sql" in r) {
    if (!text(r.sql)) fail(`${where}: "sql" should be a pattern.`);
    try {
      ruleRegex(text(r.sql));
    } catch {
      fail(`${where}: the pattern ${JSON.stringify(r.sql)} isn't a valid regular expression.`);
    }
    if (r.max !== undefined && !isCount(r.max)) fail(`${where}: "max" should be a whole number.`);
    return { sql: text(r.sql), expect: expect(r.expect), ...(r.max !== undefined ? { max: r.max as number } : {}), ...label };
  }
  if ("iterations" in r) return { iterations: limit(r.iterations, "iterations"), ...label };
  if ("queries" in r) return { queries: limit(r.queries, "queries"), ...label };
  fail(`${where}: unknown rule; use error, tool, before/after, sql, iterations, or queries.`);
}

function parseCheck(value: unknown, where: string): QuestionCheck | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) fail(`${where}: "check" should be an object.`);
  const c = value as Record<string, unknown>;
  const check: QuestionCheck = {};
  if (c.sql !== undefined) {
    const list = Array.isArray(c.sql) ? c.sql : [c.sql];
    if (!list.every((s) => typeof s === "string" && s.trim())) fail(`${where}: "sql" should be a query or a list of queries.`);
    check.sql = (list as string[]).map((s) => s.trim());
  }
  if (c.tpchQuery !== undefined) {
    if (!Number.isInteger(c.tpchQuery) || (c.tpchQuery as number) < 1 || (c.tpchQuery as number) > 22) {
      fail(`${where}: "tpchQuery" should be a TPC-H query number, 1 to 22.`);
    }
    check.tpchQuery = c.tpchQuery as number;
  }
  for (const key of ["reference", "correct", "careful", "fail", "bonus", "note"] as const) {
    if (c[key] !== undefined && typeof c[key] !== "string") fail(`${where}: "${key}" should be text.`);
    if (text(c[key])) check[key] = text(c[key]);
  }
  // Version 1 said "expect" for what a right answer has to say.
  if (!check.correct && text(c.expect)) check.correct = text(c.expect);
  if (c.rules !== undefined) {
    if (!Array.isArray(c.rules)) fail(`${where}: "rules" should be a list.`);
    check.rules = c.rules.map((r, i) => parseRule(r, `${where}, rule ${i + 1}`));
  }
  const filled = Object.values(check).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined));
  if (!filled) fail(`${where}: "check" needs at least one of sql, tpchQuery, reference, correct, careful, fail, bonus, rules.`);
  return check;
}

/** Read a question set file (version 1 or 2). Unlike a preset, a set with anything wrong
 *  is refused rather than patched up: quietly dropping a question would change what's
 *  measured. */
export function parseQuestionSet(fileText: string): QuestionSet {
  let data: unknown;
  try {
    data = JSON.parse(fileText);
  } catch {
    fail("This file isn't a question set (it isn't JSON).");
  }
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object" || d.format !== QUESTION_SET_FORMAT) fail("This file isn't a Duck Harness question set.");
  if (typeof d.formatVersion !== "number" || d.formatVersion > QUESTION_SET_FORMAT_VERSION) {
    fail("This question set was saved by a newer version.");
  }
  if (typeof d.id !== "string" || !ID.test(d.id)) fail('This question set needs an "id" (letters, digits, - _ .).');
  if (!text(d.name)) fail("This question set has no name.");
  if (d.source !== undefined && !parseSource(d.source)) fail("This question set's source isn't one this version can use.");
  const setSource = parseSource(d.source);
  const setTables = d.tables !== undefined ? parseTables(d.tables, "This question set") : undefined;

  const categories: Category[] = [];
  if (d.categories !== undefined) {
    if (!Array.isArray(d.categories)) fail('"categories" should be a list of {"id", "name"}.');
    for (const value of d.categories) {
      const c = (value ?? {}) as Record<string, unknown>;
      if (typeof c.id !== "string" || !ID.test(c.id) || !text(c.name)) fail('Each category needs an "id" and a "name".');
      if (categories.some((k) => k.id === c.id)) fail(`Two categories have the id "${c.id}".`);
      categories.push({ id: c.id, name: text(c.name) });
    }
  }

  if (!Array.isArray(d.questions) || d.questions.length === 0) fail("This question set has no questions.");
  const seen = new Set<string>();
  const questions = d.questions.map((value, index): Question => {
    const q = (value ?? {}) as Record<string, unknown>;
    const where = typeof q.id === "string" && q.id ? `Question "${q.id}"` : `Question ${index + 1}`;
    if (typeof q.id !== "string" || !ID.test(q.id)) fail(`${where} needs an "id" (letters, digits, - _ .).`);
    if (seen.has(q.id)) fail(`Two questions have the id "${q.id}".`);
    seen.add(q.id);
    if (!text(q.prompt)) fail(`${where} has no prompt.`);
    if (q.source !== undefined && !parseSource(q.source)) fail(`${where}: its source isn't one this version can use.`);
    const source = parseSource(q.source);
    if (!source && !setSource) fail(`${where} has no source, and the set has none either.`);
    if (q.tags !== undefined && !(Array.isArray(q.tags) && q.tags.every((t) => typeof t === "string"))) {
      fail(`${where}: "tags" should be a list of words.`);
    }
    let category: string | undefined;
    if (q.category !== undefined) {
      if (typeof q.category !== "string" || !categories.some((c) => c.id === q.category)) {
        fail(`${where}: category ${JSON.stringify(q.category)} isn't one of the set's categories.`);
      }
      category = q.category;
    }
    const tables = q.tables !== undefined ? parseTables(q.tables, where) : undefined;
    const check = parseCheck(q.check, where);
    return {
      id: q.id,
      title: text(q.title) || q.id,
      prompt: text(q.prompt),
      tags: ((q.tags as string[] | undefined) ?? []).map((t) => t.trim()).filter(Boolean),
      ...(category ? { category } : {}),
      ...(source ? { source } : {}),
      ...(tables ? { tables } : {}),
      ...(check ? { check } : {}),
    };
  });

  return {
    id: d.id,
    name: text(d.name),
    description: text(d.description),
    revision: Number.isInteger(d.revision) && (d.revision as number) >= 1 ? (d.revision as number) : 1,
    savedAt: typeof d.savedAt === "string" ? d.savedAt : new Date().toISOString(),
    ...(setSource ? { source: setSource } : {}),
    ...(setTables ? { tables: setTables } : {}),
    categories,
    questions,
  };
}
