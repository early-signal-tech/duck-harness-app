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
`npm run dh1` to start the app in development, or `npm run dh1:app` to build it as a
Mac app and open it (a built app is what dictation needs; run it again after pulling
changes). The app starts the agent as a child process
(`uv run --project ../duckdb-analytics-agent duck-harness-serve`) and talks to it over
JSON Lines. The **engine light** at the right of the header shows whether it's up.

To try it: leave the source on **TEST TONE** (TPC-H sample data), keep the
**Balanced** preset, type a question in the PROMPT bar, and press **Enter**. The
activity log fills as the agent works, and the answer appears on the right when it
finishes.

## 2. The face at a glance

```
┌ Header: DH-1 · presets ‹ › · A | B · A→B · Compare · Setlist · Handbook · ⚙ ──┐
├ SOURCE ┬ AGENT ─────────────────┬ CONTEXT COMPRESSOR ┬ METERS ───────────────┤
│ data   │ model, effort, knobs   │ threshold/keep/... │ IN OUT CACHE, cost,   │
│        │                        │ context meters     │ iteration LEDs        │
├ PROMPT ─────────────────────────────────────────── RUN · STOP · RUN A+B ──────┤
├ ACTIVITY (timeline + log) ──────────────┬ ANSWER ─────────────────────────────┤
└─────────────────────────────────────────┴─────────────────────────────────────┘
```

The top row is everything that shapes a run. The middle is the question. The bottom
is what happened and what came back. Compare, Setlist, and the Handbook are full
screens that take the face's place until you go back.

## 3. Header bar

The dark bar across the top holds the app's name, then DH-1's own controls: the
preset bar, the A/B switch, **Compare**, **Setlist**, and **Handbook**, which opens
this document inside the app (its contents links work, and Esc goes back). On the
right are **SETTINGS** (see [Settings](#16-settings)) and the **engine light**, which
reads ENGINE when it's up, STARTING, or OFFLINE. If it's offline, nothing can run, and the
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
- **LINE IN:** your own data, opened read-only: a DuckDB file, a `ducklake:` URI, or an
  S3 path (see below). Anything that needs credentials (S3, a DuckLake's Postgres
  catalog) uses the DuckDB secrets saved in [Settings](#16-settings).
- **SAMPLER:** CSV, TSV, Parquet, or JSON files (gzipped files too), each loaded as a
  table named after the file (`Sales 2026.csv` becomes `sales_2026`).

You can drop data files anywhere on the window to add them to the sampler.

**S3 paths.** LINE IN takes two kinds, told apart by the path:
- **A DuckDB file there** (`s3://bucket/sales.duckdb`) is attached read-only, like a
  local file.
- **Data files** (`s3://bucket/orders/*.parquet`, one CSV, Parquet, or JSON file, or a
  folder of Parquet ending in `/`) become one view, named after the folder (`orders`;
  Hive folders like `year=2026` are skipped). The files are read in place: nothing is
  copied, so each question sees them as they are right then, which suits data a
  pipeline (ES-1) keeps writing.

The hint under LINE IN says which will happen, and menus name the source "orders · S3".
GCS, R2, and HTTPS paths work the same way. A wrong path or missing credentials fails
at the start of the run with DuckDB's message.

**Connecting a DuckLake.** Save it as a DuckLake secret in **Settings → DuckDB secrets**
(its catalog's Postgres secret is picked from a list), then type `ducklake:<secret name>`
in LINE IN. An existing DuckLake secret works right away.

Whatever LINE IN opens, the agent can't change it, and it can't read any other file or
URL. On big tables, keep TIMEOUT and RESULT SIZE modest: every query scans real data.

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
- The **COST** display: the estimated dollars so far, for Haiku, Sonnet, and Opus
  (5.5), from each model's prices, cache reads and writes included. Prices differ a
  lot: per token, Sonnet costs 20× Haiku and Opus 40×, so a Sonnet run with fewer
  tokens can still cost far more.
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

**Dictation.** macOS dictation works in the prompt in a built DH-1.app: click into the
prompt, start dictation (Edit → Start Dictation, or the shortcut in System Settings →
Keyboard → Dictation), speak, then press Enter. While the words are still underlined,
the first Enter finishes them and the next one runs. Esc cancels dictation, but it's
also STOP. It doesn't work in `npm run dh1` (dev mode isn't an app bundle): use
`npm run dh1:app`, which builds DH-1 as an app and opens it.

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
- a set: the built-in **TPC-H** set (22 questions on TPC-H 0.01), or one of yours
  under **MINE**. **Open a set file…** adds a file to MINE, so it's remembered. Sets
  with categories show their questions grouped by category.
- up to four **preset columns**
- **REPEAT** ×1–×5
- how many runs go **AT A TIME**

The **NAME** box comes filled in with a suggestion: "TPC-H · 3 presets × 3 · Nov 2,
14:05". Typing adds to it; you can also change or replace it, and ↺ brings the
suggestion back. Add a one-line **NOTE** if you like. A name you edited is stored as
it is (the `setlist_name` label); one left as suggested isn't stored, since it's
rebuilt from the setlist's facts. At start, the setlist also gets an **ID**, such as
`sl-2026-11-02-1405-a7f1` (start date and time, then 4 random characters), which is
unique and on every run. Runs also record how many ran at once, since overlapping
runs take longer. EH-1 lists setlists by name and ID.

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
in the traces, labelled with its setlist (and its name), question, column, and repeat. The question
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
- **DuckDB secrets.** The credentials DuckDB uses for S3, R2, GCS, Postgres, MySQL,
  DuckLake, and HTTP, with a summary ("7 saved · 5 Postgres, 1 DuckLake, 1 S3").
  **Manage…** opens a sheet listing them by name, type, and scope (never their values),
  where **+ Add** makes one from a form for its type, **Replace** types its values again
  (saved values can't be read back), and **Delete** removes one after you confirm.
  They're kept in DuckDB's own store, `~/.duckdb/stored_secrets`: unencrypted, readable
  only by your Mac user, and shared with the `duckdb` command line.
- **Traces server.** The background Quack server that lets other programs read the
  traces while runs write them. The panel shows whether it's running, and **Stop**
  stops it. The next run starts it again.
- **Open traces in DuckDB shell.** This opens Terminal with the duckdb CLI connected
  to the traces.
- **Reset traces….** This deletes every recorded run, after you confirm. It's refused
  while runs are going.

Changing the key or the traces file restarts the engine, which stops any runs in
progress. These settings belong to the host, not DH-1, so EH-1 and the rack share
them (DuckDB secrets show wherever DH-1's agent runs: DH-1 and the rack).

## 17. Keyboard shortcuts

| Key | Does |
|---|---|
| Enter (in the prompt), ⌘↵ | Run the active slot |
| Esc | Close a menu; else leave Setlist, Compare, or the Handbook; else collapse an expanded pane; else stop a run |
| ⌘+ / ⌘− / ⌘0 | Larger / smaller / default text in Activity, Answer, Compare, Setlist, and the Handbook |
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
| DuckDB secrets | `~/.duckdb/stored_secrets/` (DuckDB's own store) | yes |
| Traces database choice (see [Settings](#16-settings)) | `~/Library/Application Support/Duck Harness/settings.json` | yes |
| Theme, displays | app storage | yes |
| Runs | `agent_traces.duckdb` in the agent checkout | yes |

## 19. Code map (for contributors and agents)

```
packages/ui-kit/      shared look and controls (Knob, Toggle, Menu, Splitter, HostBar, Markdown, themes),
                      Settings (the gear) and its DuckDB secrets sheet (SecretsSheet.tsx, secrets.ts)
packages/formats/     file formats the plugins share: sources, question sets, the TPC-H set
packages/dh1/src/
  useDh1.ts           the device's model: settings, presets, A/B runs, the setlist, start / stop
  Dh1.tsx             the face (Dh1Face, Dh1PromptBar) drawing the model; Dh1 = model + face
  harness.ts          client for the agent server's JSON Lines protocol
  useEngine.ts        the engine connection the host passes in
  settings.ts         FaceSettings, defaults, building a run request
  presets.ts          preset format, factory presets, files; usePresets.ts is the hook
  ab.ts               A/B slots and the settings diff
  runState.ts         reducer: server events → meters, LEDs, activity, timeline
  setlist.ts          Setlist model; useSetlist.ts runs it
  layout.ts           pane split, text size, timeline state
  components/         one file per panel or view (SourcePanel, AgentPanel, CompressorPanel, SetlistView, ...)
apps/dh1/             the standalone Tauri app; its src-tauri/ names the engine it runs
crates/dh-host/       the native side every app shares: starts engines, keeps presets, the
                      Keychain key, and settings.json
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
