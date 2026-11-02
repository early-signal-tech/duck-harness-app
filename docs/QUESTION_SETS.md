# Question sets

A question set is a list of questions to ask an agent, each with the data it runs on
and, optionally, how to check its answer. It's a shared format:

- **DH-1's Setlist** runs a set: every question × every preset column × N repeats.
  It only shows whether a question *has* a check.
- **EH-1** (later) grades those runs, using the checks.

The TypeScript types and reader are in `packages/formats/src/questionSet.ts`. EH-1's
Python engine will read the same files.

## The file

JSON, one set per file:

```json
{
  "format": "dh-question-set",
  "formatVersion": 1,
  "id": "tpch",
  "name": "TPC-H",
  "description": "The 22 standard TPC-H queries, asked in plain language.",
  "revision": 1,
  "savedAt": "2026-11-02T00:00:00Z",
  "source": { "kind": "tpch", "tpchScale": 0.01 },
  "questions": [
    {
      "id": "q1",
      "title": "Pricing summary report",
      "prompt": "For line items shipped on or before 1998-09-02, summarize …",
      "tags": ["basic"],
      "check": { "sql": "SELECT …", "tpchQuery": 1 }
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `format`, `formatVersion` | yes | Always `"dh-question-set"`, `1`. |
| `id` | yes | Stable, letters/digits/`-_.`. Runs are labelled with it. |
| `name` | yes | Shown in the Setlist's set picker. |
| `description` | no | One or two sentences. |
| `revision` | no (1) | Goes up on every change, so runs can tell versions apart. |
| `source` | see below | The data every question runs on, unless it has its own. |
| `questions` | yes | At least one. |

Each question:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique in the set and stable. Runs are labelled with it, so renaming one breaks comparisons with older runs. |
| `prompt` | yes | Exactly what's sent to the agent. |
| `title` | no (the id) | A short name for the grid. |
| `tags` | no | Free words, e.g. the hard part ("correlated subquery"). |
| `source` | no | Overrides the set's source. Every question needs one or the other. |
| `check` | no | How to tell if the answer is right (below). |

A **source** is the same shape presets use: `{"kind": "tpch", "tpchScale": 0.1}`,
`{"kind": "db", "dbPath": "/path/to.duckdb"}`, or `{"kind": "files", "files": ["/a.csv"]}`.

A **check** has at least one of:

- `sql`: reference SQL. Run it on the same source; the agent's numbers should match
  its result. Any correct query passes, not just this one.
- `tpchQuery`: a TPC-H query number (1–22). Compare with DuckDB's published answers,
  `tpch_answers()`, which exist for scale factors 0.01, 0.1, and 1 only.
- `expect`: what a right answer has to say, in words, for a person or a judge model.

## Strict on purpose

Presets are read leniently (a missing knob gets its default). Question sets aren't: a
file with a bad question, a duplicate id, or a question with no source is refused with
a message naming the problem. Quietly dropping or patching a question would change
what's being measured.

## Built-in sets

**TPC-H** (`packages/formats/src/sets/tpch.json`): the 22 standard queries on TPC-H
0.01, built from the agent repo's `TPCH_QUESTIONS.md`:

```bash
node scripts/tpch-question-set.mjs ../duckdb-analytics-agent/TPCH_QUESTIONS.md
```

Every question has the reference SQL and its TPC-H number. Q19 and Q22 also have an
`expect` (state your assumptions), since they're hard to phrase exactly. Each
reference SQL was run at 0.01 and gives the same number of rows as the published
answer.

One to know about: at 0.01, **Q17's right answer is "none"** (no parts qualify, the
result is NULL). It's a fair test of whether the agent reports an empty result
honestly, but it reads differently from the other 21. At 0.1 it's a real number.
