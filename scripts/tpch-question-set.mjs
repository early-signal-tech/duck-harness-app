#!/usr/bin/env node
// Builds the factory TPC-H question set from the agent repo's TPCH_QUESTIONS.md:
//
//   node scripts/tpch-question-set.mjs ../duckdb-analytics-agent/TPCH_QUESTIONS.md
//
// Writes packages/formats/src/sets/tpch.json. Each "## Qn. Title" section gives a
// question: its **Question:** line is the prompt, its SQL block the reference check, and
// the table's "Hard part for an agent" column its tag.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/tpch-question-set.mjs <path to TPCH_QUESTIONS.md>");
  process.exit(1);
}
const md = readFileSync(input, "utf8");

// The summary table: | 3 | Shipping priority | top-N with a join chain |
const hardPart = new Map();
for (const m of md.matchAll(/^\| (\d+) \| [^|]+ \| ([^|]+) \|$/gm)) hardPart.set(Number(m[1]), m[2].trim());

// Questions whose wording leaves room for interpretation (per the doc's "Checking an answer").
const AMBIGUOUS = new Set([19]);

// Raise it whenever the questions change, so grades of runs on the old wording stay apart.
// 2: Q8, Q12, Q18, Q22 reworded to match their reference SQL (2026-11-03).
const REVISION = 2;

const sections = md.split(/^## Q(?=\d+\. )/m).slice(1);
const questions = sections.map((section) => {
  const head = section.match(/^(\d+)\. (.+)$/m);
  const prompt = section.match(/^\*\*Question:\*\* (.+)$/m);
  const sql = section.match(/```sql\n([\s\S]*?)```/);
  if (!head || !prompt || !sql) throw new Error(`Couldn't read section: ${section.slice(0, 40)}`);
  const n = Number(head[1]);
  const check = { sql: sql[1].trim(), tpchQuery: n };
  if (AMBIGUOUS.has(n)) {
    check.careful = "The question is hard to state exactly, so the answer should say what it assumed.";
  }
  return {
    id: `q${n}`,
    title: head[2].trim(),
    prompt: prompt[1].trim(),
    tags: hardPart.has(n) ? [hardPart.get(n)] : [],
    check,
  };
});
if (questions.length !== 22) throw new Error(`Expected 22 questions, found ${questions.length}`);

const set = {
  format: "dh-question-set",
  formatVersion: 2,
  id: "tpch",
  name: "TPC-H",
  description: "The 22 standard TPC-H decision-support queries, asked in plain language. "
    + "Each has DuckDB's reference SQL and a published answer at scale 0.01, 0.1, and 1.",
  revision: REVISION,
  savedAt: "2026-11-03T00:00:00Z",
  source: { kind: "tpch", tpchScale: 0.01 },
  questions,
};

const out = join(dirname(fileURLToPath(import.meta.url)), "../packages/formats/src/sets/tpch.json");
writeFileSync(out, JSON.stringify(set, null, 2) + "\n");
console.log(`Wrote ${questions.length} questions to ${out}`);
