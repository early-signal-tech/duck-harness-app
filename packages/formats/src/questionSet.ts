// Question sets: a list of questions to ask an agent, each with the data it runs on and,
// optionally, how to check its answer. DH-1's Setlist runs them (questions × presets ×
// repeats); EH-1 will grade the runs using the checks. The format is described for
// people (and the Python side) in docs/QUESTION_SETS.md.
//
//   { "format": "dh-question-set", "formatVersion": 1,
//     "id": "tpch-22", "name": "TPC-H", "description": "…", "revision": 1, "savedAt": "…",
//     "source": { "kind": "tpch", "tpchScale": 0.01 },        <- default for every question
//     "questions": [
//       { "id": "q1", "title": "Pricing summary report", "prompt": "For line items …",
//         "tags": ["basic"],
//         "source": { … },                                     <- optional, overrides the set's
//         "check": { "sql": "SELECT …", "tpchQuery": 1, "expect": "…" } } ] }  <- optional

import { parseSource, type SourceSpec } from "./source";

export const QUESTION_SET_FORMAT = "dh-question-set";
export const QUESTION_SET_FORMAT_VERSION = 1;

/** How to tell whether an answer is right. Every field is optional, but a check has at
 *  least one. DH-1 only shows whether a question has a check; EH-1 uses it. */
export interface QuestionCheck {
  /** Reference SQL: run on the same source, the agent's numbers should match its result. */
  sql?: string;
  /** A TPC-H query number (1–22): compare with DuckDB's published answers (tpch_answers()),
   *  which exist for scale factors 0.01, 0.1, and 1. */
  tpchQuery?: number;
  /** What a right answer has to say or include, in words (for a person or a judge model). */
  expect?: string;
}

export interface Question {
  /** Unique within the set, and stable: runs are labelled with it. */
  id: string;
  title: string;
  /** What's sent to the agent. */
  prompt: string;
  tags: string[];
  /** Overrides the set's source for this question. */
  source?: SourceSpec;
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
  questions: Question[];
  /** Built in, read-only. */
  factory?: boolean;
}

export class QuestionSetError extends Error {}

const ID = /^[A-Za-z0-9_.-]{1,64}$/;

/** The source a question runs on: its own, or the set's. */
export function questionSource(set: QuestionSet, question: Question): SourceSpec | undefined {
  return question.source ?? set.source;
}

export function hasCheck(question: Question): boolean {
  const c = question.check;
  return !!c && (!!c.sql || c.tpchQuery !== undefined || !!c.expect);
}

export function questionSetToFile(set: QuestionSet): string {
  const { factory: _factory, ...rest } = set;
  return JSON.stringify({ format: QUESTION_SET_FORMAT, formatVersion: QUESTION_SET_FORMAT_VERSION, ...rest }, null, 2) + "\n";
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function parseCheck(value: unknown, where: string): QuestionCheck | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw new QuestionSetError(`${where}: "check" should be an object.`);
  const c = value as Record<string, unknown>;
  const check: QuestionCheck = {};
  if (text(c.sql)) check.sql = text(c.sql);
  if (c.tpchQuery !== undefined) {
    if (!Number.isInteger(c.tpchQuery) || (c.tpchQuery as number) < 1 || (c.tpchQuery as number) > 22) {
      throw new QuestionSetError(`${where}: "tpchQuery" should be a TPC-H query number, 1 to 22.`);
    }
    check.tpchQuery = c.tpchQuery as number;
  }
  if (text(c.expect)) check.expect = text(c.expect);
  if (!check.sql && check.tpchQuery === undefined && !check.expect) {
    throw new QuestionSetError(`${where}: "check" needs "sql", "tpchQuery", or "expect".`);
  }
  return check;
}

/** Read a question set file. Unlike a preset, a set with anything wrong is refused
 *  rather than patched up: quietly dropping a question would change what's measured. */
export function parseQuestionSet(fileText: string): QuestionSet {
  let data: unknown;
  try {
    data = JSON.parse(fileText);
  } catch {
    throw new QuestionSetError("This file isn't a question set (it isn't JSON).");
  }
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object" || d.format !== QUESTION_SET_FORMAT) {
    throw new QuestionSetError("This file isn't a Duck Harness question set.");
  }
  if (typeof d.formatVersion !== "number" || d.formatVersion > QUESTION_SET_FORMAT_VERSION) {
    throw new QuestionSetError("This question set was saved by a newer version.");
  }
  if (typeof d.id !== "string" || !ID.test(d.id)) {
    throw new QuestionSetError('This question set needs an "id" (letters, digits, - _ .).');
  }
  if (!text(d.name)) throw new QuestionSetError("This question set has no name.");
  if (d.source !== undefined && !parseSource(d.source)) {
    throw new QuestionSetError("This question set's source isn't one this version can use.");
  }
  const setSource = parseSource(d.source);
  if (!Array.isArray(d.questions) || d.questions.length === 0) {
    throw new QuestionSetError("This question set has no questions.");
  }

  const seen = new Set<string>();
  const questions = d.questions.map((value, index): Question => {
    const q = (value ?? {}) as Record<string, unknown>;
    const where = typeof q.id === "string" && q.id ? `Question "${q.id}"` : `Question ${index + 1}`;
    if (typeof q.id !== "string" || !ID.test(q.id)) {
      throw new QuestionSetError(`${where} needs an "id" (letters, digits, - _ .).`);
    }
    if (seen.has(q.id)) throw new QuestionSetError(`Two questions have the id "${q.id}".`);
    seen.add(q.id);
    if (!text(q.prompt)) throw new QuestionSetError(`${where} has no prompt.`);
    if (q.source !== undefined && !parseSource(q.source)) {
      throw new QuestionSetError(`${where}: its source isn't one this version can use.`);
    }
    const source = parseSource(q.source);
    if (!source && !setSource) throw new QuestionSetError(`${where} has no source, and the set has none either.`);
    if (q.tags !== undefined && !(Array.isArray(q.tags) && q.tags.every((t) => typeof t === "string"))) {
      throw new QuestionSetError(`${where}: "tags" should be a list of words.`);
    }
    const check = parseCheck(q.check, where);
    return {
      id: q.id,
      title: text(q.title) || q.id,
      prompt: text(q.prompt),
      tags: ((q.tags as string[] | undefined) ?? []).map((t) => t.trim()).filter(Boolean),
      ...(source ? { source } : {}),
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
    questions,
  };
}
