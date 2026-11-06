# EH-1 Handbook

EH-1 (Evaluator Harness 1) grades the DuckDB analytics agent's answers. It's the
second plugin in the Duck Harness family: DH-1 runs the agent, EH-1 scores what it
did. It reads the runs straight from the agent's traces and grades each one against
a question from a question set: **CORRECT** and **CAREFUL** from a judge model, and
**EFFICIENT** and **trace rules** from the traces themselves.

This handbook is the quick tour: one section per feature, a paragraph or two each.
It's written so a person or an agent can read it top to bottom before starting.

## Contents

1. [Getting started](#1-getting-started)
2. [The face at a glance](#2-the-face-at-a-glance)
3. [Header bar](#3-header-bar)
4. [INPUT: which setlist](#4-input-which-setlist)
5. [The setlist picker](#5-the-setlist-picker)
6. [SCORES and the rubric](#6-scores-and-the-rubric)
7. [EFFICIENT thresholds](#7-efficient-thresholds)
8. [JUDGE](#8-judge)
9. [METERS](#9-meters)
10. [GRADE: grading a setlist](#10-grade-grading-a-setlist)
11. [SCORECARD](#11-scorecard)
12. [VERDICT and overrides](#12-verdict-and-overrides)
13. [EXPORT: CSV and the DuckDB shell](#13-export-csv-and-the-duckdb-shell)
14. [RUN mode: one run at a time](#14-run-mode-one-run-at-a-time)
15. [Quick checks and saving them as questions](#15-quick-checks-and-saving-them-as-questions)
16. [Grader settings: when grades are new](#16-grader-settings-when-grades-are-new)
17. [Where grades live](#17-where-grades-live)
18. [Settings](#18-settings)
19. [What's remembered, and where](#19-whats-remembered-and-where)
20. [Code map (for contributors and agents)](#20-code-map-for-contributors-and-agents)
21. [Related docs](#21-related-docs)

---

## 1. Getting started

EH-1 needs three checkouts side by side: this repo (`duck-harness-app`), the agent
([`duckdb-analytics-agent`](https://github.com/early-signal-tech/duckdb-analytics-agent)),
and the grader engine (`eh1-grader`). Run `npm install` once, then `npm run eh1`. The
app starts the engine as a child process (`uv run --project ../eh1-grader eh1-serve`)
and talks to it over JSON Lines; the **engine light** at the right of the header shows
whether it's up.

The judge needs an Anthropic API key: the same one DH-1 uses, from **Settings** (the
Keychain) or `ANTHROPIC_API_KEY` in the agent's `.env`. EH-1 reads the same traces
database DH-1 writes (`agent_traces.duckdb` in the agent checkout, unless Settings
names another), through the agent's traces server, so you can grade while DH-1 runs.

## 2. The face at a glance

In **SETLIST** mode, four panels run across the top: **INPUT** (which setlist),
**SCORES** (what each score means, with the rubric), **JUDGE** (model, effort,
tolerance), and **METERS** (averages and cost). Below them, the **GRADE** bar starts
grading, and the **SCORECARD** fills the rest: questions down the side, the setlist's
preset columns across. Pick a cell and its **VERDICT** opens on the right.

**RUN** mode swaps all of that for one run at a time: a list of runs, the answer next
to its question (or your quick check), and the verdict. See [RUN mode](#14-run-mode-one-run-at-a-time).

## 3. Header bar

From the left: the **EH-1** name, the **SETLIST / RUN** switch, the **Handbook**
(this page), **Settings**, and the **engine light** (blue when the grader is running;
red with the error when it isn't). Whichever mode you were in comes back next launch.

## 4. INPUT: which setlist

**FOLLOW DH-1** always shows the newest setlist in the traces, and checks for a newer
one every 15 seconds; when DH-1 finishes a setlist, EH-1 says so and it's one press of
**GRADE SETLIST** away. **PICK** lets you choose any setlist (see the picker, next).

In the rack, FOLLOW DH-1 is **FOLLOW CHAIN**, and the cable between DH-1 and EH-1 has
**AUTO-GRADE**. When it's on, EH-1's engine grades each setlist run as soon as it
finishes, with the judge settings on this face, so the scorecard fills in while the
setlist plays; the cable counts the runs graded and the judge's cost this session.
Only setlists are auto-graded: single runs and A/B compares wait for you in RUN mode.
AUTO-GRADE starts off every time the rack opens, since grading costs money. Changing the
judge settings while it's on carries on with the new ones. The same thing from the
command line: `uv run eh1-grade --follow --set <question set file>`.

Below the choice: the setlist's ID with **Rename…**, its note, and its facts: the
question set and revision it ran, its data, how many runs completed, and how many
questions have a check. When the question set has changed since the setlist ran, the
QUESTION SET row says so in amber (`TPC-H · r2 · ran r1`): grading uses the set you
have now. If the set isn't in BUILT-IN or MINE at all, open it in DH-1's Setlist first.

**Rename…** gives a setlist your own name and note. The name box starts with its
current title, and typing adds to it; ↺ goes back to the suggested title, and leaving
the suggestion as it is stores no name. Your name and note are kept by EH-1
(`eval_setlists`), not written into the runs, and win over the ones DH-1 recorded.

## 5. The setlist picker

PICK opens a list of every setlist in the traces, grouped by question set, newest
first; the newest of each set is marked **LATEST**. **Search** matches every word
against the name, note, ID, set, preset names, and date. **ALL / NOT GRADED / GRADED**
filters by grades made with the judge settings you have now.

Each setlist shows its date, shape (presets × repeats), runs, and cost; its presets;
and **differs:** what changed between them (one setting with its values, like
`effort low / medium / high`, or the names of several; hover for all of them). On the
right, how far it ran (**COMPLETE**, **RUNNING n/m**, **STOPPED n/m**) and how much is
graded: **GRADED · AVG x/6**, **GRADED n/m** (partly), **OTHER SETTINGS** (graded,
but with another judge, rubric, or question set revision), or **NOT GRADED**.

## 6. SCORES and the rubric

Every run gets three scores, 0–2 each, for 6 in all:

- **CORRECT**: do the answer's facts match the reference? The judge decides, given the
  question's reference SQL run on the run's own data.
- **CAREFUL**: does it state the assumptions and caveats the question needs? The judge.
- **EFFICIENT**: few iterations, no wasted or failed queries, no truncated dumps. From
  the traces, no judge, so it's free.

Plus **trace rules**: pass/fail checks a question can set on what the run did (no
`read_only_violation`, called `list_tables` first, …). A broken rule shows as a red dot.

**RUBRIC ⋯** shows the scale: what earns 2, 1, and 0 on each score. Its **ALSO TELL
THE JUDGE** box is your own instructions, sent with every question (for example,
"rounding to whole percents is fine"). A blue dot on the button means you've written
some. Each question's own CORRECT, CAREFUL, FAILS IF, and BONUS notes go to the judge
too.

## 7. EFFICIENT thresholds

The **⋯** on the EFFICIENT row sets how it's scored. **Waste** is failed tool calls,
repeated identical queries, and truncated results after the first.

- **2**: no waste, and within the **iteration budget** (8 by default).
- **1**: at most **waste that still scores 1** (2 by default), and at most twice the budget.
- **0**: more waste, over twice the budget, or the run hit the iteration or token limit.

## 8. JUDGE

The judge model (**HAIKU**, **SONNET**, **OPUS**), its **EFFORT**, and the
**TOLERANCE** for numbers (within ±0.5% of the reference counts as matching, by
default). The judge answers in a fixed JSON shape: both scores, a reason for each,
whether it was unsure, and the values it compared. EH-1 opens on **HAIKU** at **LOW**
effort every time, whatever you used last: about a tenth of a cent per run, cheap
enough for AUTO-GRADE to grade every setlist run. Sonnet costs a little under a cent
per run; switch to it (or Opus) when a grade needs a closer read, and it stays until
you quit. The tolerance and the rubric's settings are remembered between launches.

## 9. METERS

The averages of CORRECT, CAREFUL, and EFFICIENT over the setlist's grades (your
overrides counted), what the judge has cost so far, and how many runs are graded with
these settings.

## 10. GRADE: grading a setlist

**GRADE SETLIST** grades every run not yet graded with these settings, four at a time,
writing each grade as it's done, so a stopped grading keeps what it finished. **STOP**
stops after the runs in progress. **Regrade all** grades everything again. The bar says
how many runs there are, how many are graded, and how many are left.

## 11. SCORECARD

Questions down the side, grouped by the set's categories (with a category average per
column); one column per preset the setlist ran. Each cell shows three bars, CORRECT,
CAREFUL, and EFFICIENT, each in two segments (half filled for an average between),
and the total out of 6, averaged over the cell's repeats. A dotted cell isn't graded
yet. The marks after the total:

- **red dot**: a trace rule broke.
- **!**: the judge failed on a repeat (an API error, say). Regrade the cell.
- **?**: the judge said it was unsure.
- **✎** (blue): your override is used here.

The **SUMMARY** row gives each column's average, how many answers scored full marks,
what each full-marks answer cost (the runs' cost divided by full marks), and broken rules.

## 12. VERDICT and overrides

Pick a cell to see its repeats: each with its three scores and the reasons, the trace
rules, and the values the judge compared, agent against reference. ✓ matches, ✕
differs, and – is **unverified**: nothing in the question's reference gives that
value, so it couldn't be checked. Add a reference to the question set to check it.

**Override…** sets your own CORRECT and CAREFUL (0–2) with a reason when you disagree
with the judge. It's kept next to the judge's scores, never replacing them; the
scorecard uses yours, and regrading keeps it. **Clear override** goes back to the
judge's. EFFICIENT comes from the traces, so it isn't overridden. **Regrade this cell**
asks the judge again for just that cell's repeats.

## 13. EXPORT: CSV and the DuckDB shell

**EXPORT ▾** on the scorecard:

- **Export scorecard as CSV…** saves one row per graded run, in scorecard order: the
  setlist, set, category, question, column, preset, repeat, and run ID; the scores that
  count (yours where you overrode) and the judge's beside them; your reason; rules
  broken; the judge's reasons; and costs.
- **Open grades in DuckDB shell** opens Terminal with the duckdb CLI on the traces, and
  copies a query for this scorecard's grades to your clipboard: paste it there.

## 14. RUN mode: one run at a time

**RUNS** lists recent runs from the traces: **ALL**, **SINGLE** (from DH-1's face),
**A/B**, or **SETLIST**, with a search over prompts, presets, questions, and run IDs.
Each shows when it ran, its preset and kind, and its newest grade (`5/6`, `6/6 · QUICK`,
`RULE ✕`, `NOT GRADED`).

Pick one and the middle shows its question, facts, and answer. The bar above the answer
says what it's graded against: **SETLIST QUESTION** (the question its setlist labels
name), **SAME PROMPT** (a question with the same prompt in one of your sets),
**PICKED** (one you chose), or **NO MATCH**, which means a quick check. **Change…** (or
**Pick a question…**) lists every question in every set, and a quick check. If the run
used other data than the question, the bar says so. With a question, its check is
shown read-only beside the answer.

The **VERDICT** on the right is the newest grade against that question or quick check,
with which judge made it and when, and the same reasons, values, and override as in
SETLIST mode, plus the reference SQL's results (rows, or the error). **GRADE RUN**
grades it with the **JUDGE** settings below. Grading a setlist's run against its
question uses the same settings as grading the setlist, so its scorecard sees it too.

## 15. Quick checks and saving them as questions

When a run has no question, write a quick check: **CORRECT IS** (what a right answer
says; needed), **REFERENCE SQL** (optional; it runs read-only on the run's own data),
and **CAREFUL MEANS** (optional). Editing a check and grading again makes a new grade
beside the old one.

The reference SQL needs to know the run's data. Runs record it (`data_source`) since
the agent started keeping it; older runs on a database file or a lake use the path they
reported, and older runs on in-memory data (TPC-H, loaded files) can't run it: the
judge grades against CORRECT IS alone.

**Save as a question…** turns the check into a permanent test: it adds the run's prompt
and your check to one of your sets (MINE), or to a new **Quick checks** set, with a
title and, if the set has them, a category. The set is saved as its next revision; the
question keeps the run's data when it's different from the set's.

## 16. Grader settings: when grades are new

A grade belongs to a **grader setting**: the judge model, effort, tolerance, iteration
budget, waste threshold, your rubric notes, and the question set and its revision.
Change any of them and grading makes new grades beside the old ones; switch back and
the old ones show again. That's why a setlist can say **OTHER SETTINGS**: it's graded,
just not with what the face has now. Changing the EFFICIENT thresholds grades anew
with the judge too, since a grade carries all of its scores together.

## 17. Where grades live

In the agent's traces database, next to the runs:

- **`eval_grades`**: one row per run per grader setting (`grader_key`). The scores,
  reasons, compared values (`judge_values`), rules, what the reference SQL returned,
  the judge's model and cost, your `override` ({correct, careful, why, at}), and for
  quick checks the check itself (`quick_check`, with `question_set = 'quick'`).
- **`eval_setlists`**: your names and notes for setlists.

Join to `agent_runs` on `run_id` for the run itself (its labels hold the setlist,
question, column, and repeat). EXPORT's shell query is a good start.

## 18. Settings

The same as DH-1's, for the same files: the **API key** (in the Keychain; only its last
four characters are shown), the **traces database**, the **DuckDB shell**, and the
**theme** and display options. The traces server belongs to DH-1's agent, so it isn't
managed here.

## 19. What's remembered, and where

- **Grades, overrides, setlist names**: in the traces database (above).
- **The tolerance, rubric notes, and EFFICIENT thresholds**: in the app
  (`eh1.grader`), so they come back next launch. The judge model and effort don't:
  every launch starts on Haiku at low effort.
- **FOLLOW / PICK and SETLIST / RUN**: in the app too (`eh1.input`, `eh1.view`).
- **Question sets you save to**: MINE, in `~/Library/Application Support/Duck Harness/Question Sets/`,
  shared with DH-1.
- **The API key and traces path**: Settings, shared with DH-1.

## 20. Code map (for contributors and agents)

In this repo:

- `apps/eh1/`: the Tauri app. `src-tauri/src/lib.rs` starts the engine and relays JSON
  Lines; `question_sets.rs` and `files.rs` read and write files; `settings.rs` is DH-1's.
- `packages/eh1/src/`:
  - `useEh1.ts` is the device's model: judge settings, setlists, grades, grading,
    overrides, export, and following DH-1. Every view of EH-1 draws it.
  - `Eh1.tsx` is the SETLIST face (`Eh1Face`), and `Eh1`, the model with its face.
  - `RunView.tsx` is RUN mode.
  - `SetlistPicker.tsx` is the PICK list and rename form.
  - `Verdict.tsx` is the verdict card.
  - `Flyouts.tsx` holds RUBRIC and EFFICIENT.
  - `engine.ts` is the protocol client.
  - The pure logic, with tests in `__tests__/`: `scorecard.ts`, `picker.ts`, `runs.ts`, `exportGrades.ts`.

In `eh1-grader`:

- `traces.py`: runs and the EH-1 tables.
- `grade.py`: grading setlists and single runs.
- `judge.py`: the judge.
- `efficiency.py`: EFFICIENT.
- `rules.py`: trace rules.
- `reference.py`: reference SQL.
- `serve.py`: the protocol.
- `cli.py`: `eh1-grade`.

## 21. Related docs

- [QUESTION_SETS.md](QUESTION_SETS.md): the question set format, checks, and trace rules.
- [HANDBOOK.md](HANDBOOK.md): DH-1, which makes the runs EH-1 grades.
- `eh1-grader/README.md`: the engine, its protocol, and how EFFICIENT is scored.
