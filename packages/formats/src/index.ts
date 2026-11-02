export * from "./source";
export * from "./questionSet";

import tpch from "./sets/tpch.json";
import { parseQuestionSet, type QuestionSet } from "./questionSet";

/** The built-in question sets (read-only). Parsed like any file, so they're checked too. */
export const FACTORY_QUESTION_SETS: QuestionSet[] = [tpch].map((data) => ({
  ...parseQuestionSet(JSON.stringify(data)),
  factory: true,
}));
