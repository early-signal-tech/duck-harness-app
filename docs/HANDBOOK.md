# DH-1 Handbook

DH-1 (Duck Harness 1) is a desktop app for running and studying the DuckDB analytics
agent. It looks like an audio plugin: knobs, switches, meters, and presets. Pick some
data, ask a question, and watch the agent work out the answer with SQL, with every
setting that shapes the run within reach.

This handbook is the quick tour: one section per feature, a paragraph or two each.
It's written so a person or an agent can read it top to bottom before starting.

## Contents

1. [Getting started](#1-getting-started)
2. [The face at a glance](#2-the-face-at-a-glance)
3. [Header bar](#3-header-bar)
4. [Presets](#4-presets)
5. [SOURCE: the data](#5-source-the-data)
6. [AGENT: model and knobs](#6-agent-model-and-knobs)
7. [CONTEXT COMPRESSOR](#7-context-compressor)
8. [METERS](#8-meters)
9. [PROMPT bar: running](#9-prompt-bar-running)
10. [ACTIVITY and the run timeline](#10-activity-and-the-run-timeline)
11. [ANSWER](#11-answer)
12. [Pane controls: text size, expand, resize](#12-pane-controls-text-size-expand-resize)
13. [A/B and Compare](#13-ab-and-compare)
14. [Setlist](#14-setlist)
15. [Traces: where runs are recorded](#15-traces-where-runs-are-recorded)
16. [Settings](#16-settings)
17. [Keyboard shortcuts](#17-keyboard-shortcuts)
18. [What's remembered, and where](#18-whats-remembered-and-where)
19. [Code map (for contributors and agents)](#19-code-map-for-contributors-and-agents)
20. [Related docs](#20-related-docs)

---

## 1. Getting started

DH-1 needs two checkouts side by side: this repo (`duck-harness-app`) and the agent,
[`duckdb-analytics-agent`](https://github.com/early-signal-tech/duckdb-analytics-agent).
It needs an Anthropic API key: paste one into **Settings** (the gear in the header),
or put `ANTHROPIC_API_KEY` in the agent's `.env`. Then run `npm install` once and
`npm run dh1` to start the app. The app starts the agent as a child process
(`uv run --project ../duckdb-analytics-agent duck-harness-serve`) and talks to it over
JSON Lines. The **engine light** at the right of the header shows whether it's up.

To try it: leave the source on **TEST TONE** (TPC-H sample data), keep the
**Balanced** preset, type a question in the PROMPT bar, and press **Enter**. The
activity log fills as the agent works, and the answer appears on the right when it
finishes.

## 2. The face at a glance

```
┌ Header: DH-1 · presets ‹ › · A | B · A→B · Compare · Setlist · ⚙ · engine ────┐
├ SOURCE ┬ AGENT ─────────────────┬ CONTEXT COMPRESSOR ┬ METERS ───────────────┤
│ data   │ model, effort, knobs   │ threshold/keep/... │ IN OUT CACHE, cost,   │
│        │                        │ context meters     │ iteration LEDs        │
├ PROMPT ─────────────────────────────────────────── RUN · STOP · RUN A+B ──────┤
├ ACTIVITY (timeline + log) ──────────────┬ ANSWER ─────────────────────────────┤
└─────────────────────────────────────────┴─────────────────────────────────────┘
```

The top row is everything that shapes a run. The middle is the question. The bottom
is what happened and what came back. Compare and Setlist are full screens that take
the face's place until you go back.

## 3. Header bar

The dark bar across the top holds the app's name, then DH-1's own controls: the
preset bar, the A/B switch, **Compare**, and **Setlist**. On the right are
**SETTINGS** (see [Settings](#16-settings)) and the **engine light**, which reads
ENGINE when it's up, STARTING, or OFFLINE. If it's offline, nothing can run, and the
status line in METERS says so.

## 4. Presets

A preset is a saved set of agent settings: every knob in AGENT and CONTEXT
COMPRESSOR. It can also include a source. The prompt is never part of a preset. Use
‹ › to step through presets, or open the menu to pick one. The menu also has
**Save**, **Save as…** (with an "include source" option), **Rename…**, **Delete…**,
**Import…**, and **Export…**. When you turn a knob after loading a preset, the bar
shows **EDITED**.

There are three factory presets, which can't be changed:
- **Quick & Cheap:** TPC-H 0.01, low effort, 10 iterations, 100 rows, 15 s timeout,
  8K max tokens.
- **Balanced (default):** TPC-H 0.1 and the default settings.
- **Deep Dive:** TPC-H 1, high effort, 40 iterations, 500 rows, 40K chars, 60 s
  timeout, 20K max tokens.

Your own presets are JSON files in
`~/Library/Application Support/Duck Harness/Presets/dh1/`. Each file names its device
and format version. Every run records which preset it used, the preset's revision,
and whether it had been edited.

## 5. SOURCE: the data

SOURCE picks the data the agent queries. It has three modes, named like audio
inputs:
- **TEST TONE:** generated TPC-H data (orders, customers, line items, parts,
  suppliers), built in memory. The SCALE knob sets the size: 0.01, 0.1 (about 100 MB),
  or 1. TPC-H has known correct answers, which makes it the place to compare settings.
- **LINE IN:** your own DuckDB file, or a `ducklake:` URI. It opens read-only. For a
  DuckLake that needs credentials, save its connection as a persistent DuckDB secret
  once, then type `ducklake:<secret name>` here (see below).
- **SAMPLER:** CSV, TSV, Parquet, or JSON files (gzipped files too), each loaded as a
  table named after the file (`Sales 2026.csv` becomes `sales_2026`).

You can drop data files anywhere on the window to add them to the sampler.

**Connecting a DuckLake.** The engine runs a plain `ATTACH '<what you typed>' AS source
(READ_ONLY)`, so a DuckLake whose catalog and storage need credentials (Postgres,
S3, ...) should be saved as persistent secrets, which every DuckDB process on your Mac
can use:

```sql
-- once, in the duckdb CLI; stored under ~/.duckdb/stored_secrets/
CREATE PERSISTENT SECRET my_s3 (TYPE s3, KEY_ID '…', SECRET '…', REGION '…');
CREATE PERSISTENT SECRET my_lake (
    TYPE ducklake,
    METADATA_PATH 'postgres:dbname=… host=… user=… password=…',
    DATA_PATH 's3://bucket/path/'
);
```

Then put `ducklake:my_lake` in LINE IN. It's attached read-only, so the agent can't
change anything, whatever SQL it writes. On big tables, keep TIMEOUT and RESULT SIZE
modest: every query scans real data.

## 6. AGENT: model and knobs

The AGENT panel holds how the agent thinks and how much it's allowed to do. **MODEL**
picks Haiku, Sonnet, or Opus (5.5). **STRUCTURED** asks for the answer as a summary,
key findings, caveats, and supporting SQL instead of free text. **CACHE** turns on
prompt caching, which makes each turn after the first much cheaper. The knobs are:
- **EFFORT:** how hard Claude thinks, from low to max.
- **ITERATIONS:** how many tool rounds the agent gets before it has to wrap up.
- **RESULT SIZE:** how much of each query result Claude sees. Click "more ›" to set
  rows, total chars, and the per-value clip separately. Bigger results cost more on
  every later turn, because they stay in the conversation.
- **TIMEOUT:** how long a single query may run.
- **MAX TOKENS:** the longest response Claude may write per call.

Drag a knob, scroll it, or use the arrow keys. Double-click it to reset it to the
default. On a narrow window the panel switches to a compact layout.

## 7. CONTEXT COMPRESSOR

Each iteration resends the whole conversation, so old query results pile up and get
paid for again on every call. The compressor uses the API's context editing to clear
**old tool results** once the prompt passes a size. Claude's messages and every SQL
query it ran are kept, so it knows what it did and can rerun a query.

The controls:
- **ON/OFF**
- **THRESHOLD:** the prompt size where clearing starts. The default is 80K, which keeps
  Haiku under its 100K price step.
- **KEEP:** how many recent tool results always stay.
- **CLEAR ≥:** the least a clear must remove to be worth breaking the prompt cache.
- **SIDECHAIN:** tools whose results are never cleared. By default these are
  `list_tables` and `describe_table`.

The meters show it working. **CONTEXT IN** is the current prompt size against the
threshold line, with hatching where the price steps up. **GAIN REDUCTION** is how
much the last clear removed.

## 8. METERS

METERS is the run's live readout:
- Three vertical meters: **IN** (prompt tokens), **OUT** (output tokens), and **CACHE**
  (the share of the prompt read from cache).
- The **COST** display: the estimated dollars so far. It only works for models with
  known prices.
- The **ITERATION** LEDs: one per allowed iteration, lit as each API call returns. An
  error lights its LED differently.
- The **status line:** READY, RUNNING with a clock, then how the run ended (COMPLETED,
  HIT ITERATION LIMIT, STOPPED, and so on).

## 9. PROMPT bar: running

Type the question and press **Enter**, **⌘↵**, or **RUN**. **STOP** (or **Esc**)
cancels the run. A stopped run still records what it did. **RUN A+B** runs both A/B
slots at the same time (see [A/B](#13-ab-and-compare)). RUN stays disabled until a
question is typed and the source is ready. It's also disabled while a run or a
setlist is going, and its tooltip says why.

## 10. ACTIVITY and the run timeline

The ACTIVITY log lists everything the agent does, numbered by iteration:
- each API call
- each tool call, with its SQL or details in a box
- thinking
- compressor clears
- errors

Every run ends with an **END** line that says whether there's an answer, which is
useful when the Activity pane is expanded and the answer is hidden. The log follows
the newest line unless you scroll up to read.

The **RUN TIMELINE** sits above the log, collapsed to one summary line by default.
It starts collapsed on every launch. Open it to see the run as a waveform: one bar
per iteration, its height the prompt size, its fill what the iteration did (list
tables, describe, query, error, answer). Blue ticks mark compressor clears, and a
dashed line marks the threshold. Click a bar to jump to that iteration in the log.

## 11. ANSWER

The ANSWER pane shows the final answer when a run finishes. It shows Markdown, or the
structured answer (summary, key findings, caveats, supporting SQL) when STRUCTURED is
on. Below the answer are the run's iterations, API calls, time, cost, and the
**run id**, which you can select and paste into the traces. **Copy** puts the answer
on the clipboard as Markdown. If a run hit a limit, the answer is the best one the
agent could give from the work it had done.

## 12. Pane controls: text size, expand, resize

The Activity and Answer panes share a text size (11–20, default 16). Change it with
**A− / A+** or **⌘− / ⌘+**, and reset it with **⌘0**. **Expand ↗** makes a pane fill
the window. **Esc** or **Collapse ↙** brings the face back. Drag the divider between
the panes to resize them, and double-click it to reset. The split and text size are
remembered between launches.

## 13. A/B and Compare

**A | B** in the header gives the face two sets of agent settings, like A/B on a
hardware plugin. Each slot has its own knobs and preset. The source and the prompt
are shared, so it's always the same question on the same data. **A→B** copies the
active slot over the other. **RUN A+B** runs both at once, and tags the pair in the
traces so they can be found together.

**Compare** opens a side-by-side view of the two runs:
- which settings differ
- each run's status, iterations, time, cost, prompt and output tokens, cache hit,
  peak context, and clears, with the better value of each marked
- both answers

Compare shows the facts. Judging which answer is better is EH-1's job. Even with
identical settings, expect some spread from the model's own variation.

## 14. Setlist

The Setlist runs a **question set** against several presets, several times each, and
compares how the presets behave. Open it from **Setlist** in the header. Choose:
- a set: the built-in **TPC-H** set (22 questions on TPC-H 0.01), or **Open a set
  file…**
- up to four **preset columns**
- **REPEAT** ×1–×5
- how many runs go **AT A TIME**

Then press **RUN SETLIST**. Each run uses the column's preset settings, on the
question's own data, with the question's prompt. Runs go question by question, so a
slow patch on the API hits every preset alike.

**The grid.** Each cell has a lamp per repeat:
- dark: completed
- gray: hit a limit
- dashed: error
- blue: running
- dotted: queued
- struck through: stopped

A cell also shows its median cost and iterations, and the **±spread** between its
repeats. The summary row totals each column. Click a cell to see each repeat's
answer, or to **load that preset and question onto the face**.

**While it runs.** A running setlist has the engine to itself, so RUN and RUN A+B
wait. The header button shows its progress (`SETLIST 47/198`), and it keeps going
while you're back on the face. A projected total cost appears once every column has
finished a run.

**Results and labels.** Results stay on screen until you clear them, but every run is
in the traces, labelled with its setlist, question, column, and repeat. The question
set format is described in [QUESTION_SETS.md](QUESTION_SETS.md).

## 15. Traces: where runs are recorded

Every run is recorded by the agent in `agent_traces.duckdb` in the agent checkout,
the same file its CLI uses. `agent_runs` has one row per run: the status, usage,
cost, the config the run used, `preset` (id, name, revision, edited), and `labels`.
Labels identify A/B pairs (`ab`, `pair`) and setlist runs (`setlist`, `question`,
`column`, `repeat`, ...). The agent's traces tables hold every API call and tool call,
including the exact SQL. The run id in the ANSWER pane is the key into all of it.
These traces are what EH-1, the evaluator plugin, will grade.

Where the traces file lives, the traces server, opening the traces in the duckdb CLI,
and resetting them are all in [Settings](#16-settings).

## 16. Settings

**SETTINGS** (the gear in the header) holds what belongs to the app, not to a run:
- **Appearance.** **THEME** is light, dark, or AUTO (follows the system). **DISPLAYS**
  makes the small readouts (the cost display, knob values) charcoal LCDs or outlined
  white.
- **Anthropic API key.** It's saved in the macOS Keychain and given to the engine,
  where it wins over the agent's `.env`. The panel says where the current key comes
  from (Keychain, environment, or `.env`) and shows its last four characters, never
  the whole key.
- **Traces database.** This is the file runs are recorded in: the agent's
  `agent_traces.duckdb` by default, or any file you choose.
- **Traces server.** The background Quack server that lets other programs read the
  traces while runs write them. The panel shows whether it's running, and **Stop**
  stops it. The next run starts it again.
- **Open traces in DuckDB shell.** This opens Terminal with the duckdb CLI connected
  to the traces.
- **Reset traces….** This deletes every recorded run, after you confirm. It's refused
  while runs are going.

Changing the key or the traces file restarts the engine, which stops any runs in
progress. These settings belong to the host, not DH-1, so EH-1 and the rack will
share them.

## 17. Keyboard shortcuts

| Key | Does |
|---|---|
| Enter (in the prompt), ⌘↵ | Run the active slot |
| Esc | Close a menu; else leave Setlist or Compare; else collapse an expanded pane; else stop a run |
| ⌘+ / ⌘− / ⌘0 | Larger / smaller / default text in Activity, Answer, Compare, and Setlist |
| Arrow keys, scroll (on a knob) | Turn the knob |
| Double-click (knob, divider) | Reset to the default |

## 18. What's remembered, and where

| What | Where | Survives restart |
|---|---|---|
| Knobs, source, prompt, A/B slots | app storage (`dh1.settings`) | yes |
| Pane split, text size | app storage (`dh1.layout`) | yes; the timeline always starts collapsed |
| Setlist setup (set, columns, repeats, at a time) | app storage (`dh1.setlist`) | yes |
| Setlist results, the current run's activity | memory | no; everything is in the traces |
| Your presets | `~/Library/Application Support/Duck Harness/Presets/dh1/*.json` | yes |
| API key | macOS Keychain, service "Duck Harness" | yes |
| Traces database choice (see [Settings](#16-settings)) | `~/Library/Application Support/Duck Harness/settings.json` | yes |
| Theme, displays | app storage | yes |
| Runs | `agent_traces.duckdb` in the agent checkout | yes |

## 19. Code map (for contributors and agents)

```
packages/ui-kit/      shared look and controls (Knob, Toggle, Menu, Splitter, HostBar, Markdown, themes)
packages/formats/     file formats the plugins share: sources, question sets, the TPC-H set
packages/dh1/src/
  Dh1.tsx             the device: face layout, running, keyboard
  harness.ts          client for the agent server's JSON Lines protocol
  useEngine.ts        the engine connection the host passes in
  settings.ts         FaceSettings, defaults, building a run request
  presets.ts          preset format, factory presets, files; usePresets.ts is the hook
  ab.ts               A/B slots and the settings diff
  runState.ts         reducer: server events → meters, LEDs, activity, timeline
  setlist.ts          Setlist model; useSetlist.ts runs it
  layout.ts           pane split, text size, timeline state
  components/         one file per panel or view (AgentPanel, CompressorPanel, SetlistView, ...)
apps/dh1/             the standalone Tauri app: Settings.tsx (the gear), and src-tauri/,
                      which starts the engine and keeps presets, the Keychain key, and settings.json
scripts/              tpch-question-set.mjs builds the TPC-H set from the agent repo
```

Changes to what a run can do go into the agent repo's protocol
(`duckdb_agent/serve.py`) first, then into `harness.ts`. Run `npm test` and
`npm run typecheck` before a PR.

## 20. Related docs

- [README](../README.md): how the repo is organized, and status.
- [QUESTION_SETS.md](QUESTION_SETS.md): the question set file format.
- [UI_REQUESTS.md](UI_REQUESTS.md): the UI wish list.
- [LATER.md](LATER.md): ideas parked for later (EH-1, the rack, Replay SQL, a lite
  version, ...).
