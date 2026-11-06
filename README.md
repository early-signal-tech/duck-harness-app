# DH-1 (Duck Harness 1)

A desktop app for running and evaluating the
[DuckDB analytics agent](https://github.com/early-signal-tech/duckdb-analytics-agent),
laid out like an audio plugin: knobs on the front, deeper settings in flyouts, and
presets you can save and compare.

Built with [Tauri](https://tauri.app): a native macOS window (the system WebKit view,
no Electron) with a React + TypeScript UI. The agent itself stays in Python and runs as
a child process.

## How it's organized

DH-1 is the first of several plugins. EH-1 (an evaluator for agent runs) comes next,
and later a rack app that chains them. They share one look, so this repo holds all the
UIs, split into packages:

```
packages/
  ui-kit/   shared look and controls: colors, fonts, knobs, switches, panels, LEDs,
            Markdown, the splitter, the host bar, theme handling
  formats/  file formats the plugins share: sources and question sets
            (docs/QUESTION_SETS.md), plus the built-in TPC-H set
  dh1/      the DH-1 device: its face, run state, settings, and the client for the
            agent server's protocol
  eh1/      the EH-1 device: grading a setlist, the scorecard, and the client for the
            grader's protocol (eh1-grader)
apps/
  dh1/      DH-1 as a standalone app: a Tauri window (src-tauri/) around the device
  eh1/      EH-1 as a standalone app (npm run eh1), starting eh1-grader's eh1-serve
  rack/     the Rack (npm run rack): one window running both engines, with DH-1 and
            EH-1 side by side
crates/
  dh-host/  the native side every app shares: the engines, settings, presets,
            question sets; each app's src-tauri only says which engines it runs
```

Each plugin is a **device** (a component that takes an engine connection) inside a
thin **host** (the window chrome, theme, and engine processes). A standalone app is one
host with one device; the rack will be one host with several. Each device's styles are
scoped under its own class (`.dh1`), so devices can sit side by side.

The engines are Python and live in their own repos. DH-1's is
[duckdb-analytics-agent](https://github.com/early-signal-tech/duckdb-analytics-agent).

### DH-1

```
React (packages/dh1)  ──engine_send("dh1", line)──▶  Rust (crates/dh-host)  ──stdin──▶  duck-harness-serve
       ▲                                                   │                        (Python agent)
       └──── "engine-message" {engine: "dh1"} ◀────────────┴──────── stdout ◀───────────────┘
```

- **`crates/dh-host/src/engines.rs`** starts each engine the host runs (`dh1`, `eh1`)
  when the app opens and relays its JSON Lines protocol. Every command and event names
  its engine, so one host can run several (the rack). Closing the app closes each
  engine's input, which stops its work, and it exits.
- **`EngineTransport`** (packages/ui-kit) is how a device's client reaches its engine;
  the host passes `tauriTransport("dh1")`.
- **`packages/dh1/src/harness.ts`** is the TypeScript client for the protocol:
  `hello()`, `run()` (with live events), and `stop()`. Its types mirror
  `duckdb_agent/serve.py` and the `EventCallback` events in `duckdb_agent/loop.py`.
- **`packages/dh1/src/useDh1.ts`** is the device's model: its settings and presets, the
  A/B runs, the setlist, and starting and stopping. **Rack presets** save the chain as a file: the devices in order, DH-1's preset (by id),
and each EH-1's judge settings (format `dh-rack`, in
`~/Library/Application Support/Duck Harness/Presets/rack/`; `rackPresets.ts`). There are
three factory ones (DH-1 + AUTO GRADER, DH-1, EH-1); Save as… keeps your own. A ● next to
the name means the rack has moved away from it. Every DH-1 run records the preset it was
played from in its labels (`rack_preset`, and `rack_edited` if the rack had changed).

Each device is a model plus views, so
  the rack can show the same device as a compact card, a full editor, and a transport.
- **`packages/dh1/src/Dh1.tsx`** is the face (`Dh1Face`; `Dh1PromptBar` is its prompt
  bar, which a host with a transport can leave out):
  - SOURCE: the TPC-H test tone, a DuckDB file, or data files
  - AGENT: model switch, STRUCTURED and CACHE, and the Effort, Iterations, Result
    Size, Timeout, and Max Tokens knobs
  - CONTEXT COMPRESSOR: context editing as a compressor (threshold, keep, clear at
    least, the sidechain of never-cleared tools, the prompt's size against the
    threshold, and how much each clear freed)
  - METERS: cost, iteration LEDs, and token / cache meters
  - the prompt with RUN and STOP
  - the Activity pane, topped by the run timeline (one bar per iteration: its prompt
    size, what it did, and compressor clears; click a bar to find it in the log), and
    the Answer pane
- **`packages/dh1/src/runState.ts`** turns the server's events into what the meters
  show.

Knobs: drag up or down (hold Shift for fine control), scroll, or use the arrow keys;
double-click resets to the default. Enter or ⌘↵ runs, Esc stops (or closes an expanded
pane), and ⌘+ / ⌘− change the Activity and Answer text size. Settings, theme, and
layout are remembered between launches.

**Presets** store how the agent runs (model, effort, iterations, and later the other
knobs), and can also store the source. The factory presets each load Test Tone at
their own TPC-H scale: Quick & Cheap 0.01, Balanced 0.1, Deep Dive 1. For your own
presets, Save as has an Include source checkbox. The prompt is never saved. They're
JSON files in
`~/Library/Application Support/Duck Harness/Presets/dh1/`. The folder is shared by the
standalone app and the rack, and you can copy or back up the files directly. Each file
names its device and format version (`packages/dh1/src/presets.ts`). Every run sends
the preset it came from (id, name, revision, and whether the knobs were edited), and the
agent records it in `agent_runs.preset`. The header shows EDITED when the knobs no
longer match the loaded preset.

UI requests and their triage are tracked in [docs/UI_REQUESTS.md](docs/UI_REQUESTS.md). Ideas parked on purpose are in [docs/LATER.md](docs/LATER.md).

## Development

You need Rust, Node 22+, and [uv](https://docs.astral.sh/uv/). Clone the agent repo next
to this one:

```
Github/
  duckdb-analytics-agent/   # with ANTHROPIC_API_KEY in its .env
  duck-harness-app/
```

Then, from the repo root:

```bash
npm install
npm run dh1        # DH-1 in development (Tauri + Vite)
npm run eh1        # EH-1
npm run rack       # the Rack: DH-1 and EH-1 side by side
npm test           # unit tests for every package
npm run typecheck  # type-check every package and app
```

The host finds each engine (crates/dh-host, `discovery.rs`) in this order:

1. **A dev override:** `DH1_AGENT_DIR` (the agent) or `EH1_GRADER_DIR` (the grader)
   names a checkout to run with `uv run --project`.
2. **The discovery file**, `~/Library/Application Support/Duck Harness/engines.json`,
   where an installed CLI will record its engines. You can write it by hand:
   ```json
   {"format": "dh-engines", "formatVersion": 1,
    "engines": {"dh1": {"command": ["/path/to/duck-harness-serve"], "version": "0.1.0"},
                "eh1": {"command": ["/path/to/eh1-serve"], "version": "0.1.0"}}}
   ```
   An engine started from here runs in that folder, so it doesn't read a checkout's
   `.env`: save the API key in Settings (the Keychain). A file that can't be read is
   skipped, and Settings says why.
3. **A checkout next to this repo** (`../duckdb-analytics-agent`, `../eh1-grader`), run
   with `uv run --project` from that folder, so it uses the checkout's `.env`.

Every engine gets the same traces file as an absolute `--traces-db`: the one chosen in
Settings, else `agent_traces.duckdb` in the agent checkout (the CLI's default too).
Settings shows where each engine came from. If `uv` isn't on your PATH, set `DH1_UV` to
its full path. Engine logs show up in the terminal, prefixed `[agent]` or `[grader]`.

## The Rack

`apps/rack` (`npm run rack`) is one window running both engines (`dh1` and `eh1`), laid
out like a DAW (wireframes: the "RACK v3" boards on the design canvas):

- **The transport** across the top plays the chain: the rack preset (‹ name ▾ ›), the
  prompt, what PLAY makes (RUN, A/B, or SETLIST), PLAY and STOP, then Settings and one
  light per engine. SETLIST opens
  DH-1's Setlist to pick the questions and presets; while one plays, the transport shows
  its progress.
- **The panel** shows the chain's output (the latest take: a run's answer, an A/B's two
  answers, or a setlist's progress) or, when you open a device, its full editor. ✕ goes
  back to the output.
- **The rack** along the bottom holds the chain as compact cards, with + slots between
  them that offer only what fits there (`chainRules.ts`): one instrument per chain
  (DH-1, or EH-1 on its own), and devices that take runs after one that gives them.
  Click a card to select it and Delete (⌫) removes it, asking first if it's working;
  right-click a card for its menu (open, collapse, delete). A device that no longer
  fits (AUTO GRADER after DH-1 was deleted) is dashed, says why, and stays off.
  ▾ RACK, or ⌘B, folds the whole rack to a bar of chips. A card has a vertical strip (its engine light, ⤢ to
  open it), a tile per section showing its current value (a tile opens the editor at that
  section), and a few essentials (DH-1: preset, model, EFFORT, cost; EH-1: a heat map of
  the scorecard, its meters, how much is graded). Double-click a strip to collapse the
  card to just the strip; it keeps working.
- **AUTO GRADER** is a utility that wraps its own EH-1, after DH-1. Its power button is
  its switch: on, the EH-1 inside grades each setlist run as it finishes (eh1-grader's
  `follow`) with its own judge settings, and the card shows the latest grade and what it
  graded and spent. Its inner slot (or ⤢) opens that EH-1 in the panel. It starts off
  each time, and there's one per chain.

Each device is a model plus views (`useDh1` / `useEh1`, drawn by `Dh1Card` / `Eh1Card`,
`Dh1Face` / `Eh1Face`, and `Dh1Output`). The rack keeps the models, so a device keeps
running whatever the panel shows; an EH-1 keeps its settings under its own prefix
(`useEh1(…, { storage })`), so AUTO GRADER's EH-1 and a standalone EH-1 don't share
them. The chain itself is also remembered per window (`rack.chain`), so the rack opens as you
left it. A key pressed inside one device only reaches that
device (`keyForOtherDevice`), so Esc in EH-1 doesn't stop a DH-1 run. If the two engines
were built for different traces schemas, a banner says which is which (`engineProblems`).

## Status

- [x] Tauri app with the Python agent server as a child process
- [x] TypeScript protocol client
- [x] Plugin face: source, model switch, Effort and Iterations knobs, cost LCD, iteration LEDs, answer
- [x] Shared UI kit and device/host split, ready for more plugins
- [x] Presets: factory and saved, ‹ › and a menu in the header; saved as files in
      ~/Library/Application Support/Duck Harness/Presets/dh1/ and recorded with each run
- [x] Every agent knob: result size (rows, chars, cell clip), timeout, max tokens,
      structured answer, caching
- [x] Context compressor: threshold, keep, clear-at-least, sidechain, context and
      gain-reduction meters
- [x] Run timeline: one bar per iteration (prompt size, what it did, clears)
- [x] A/B compare: two sets of settings, RUN A+B, and a side-by-side view
- [x] Setlist: a question set × preset columns × repeats, run a few at a time, with
      medians and spread per cell; every run labelled for EH-1 (docs/QUESTION_SETS.md)
- [x] EH-1, first build: grade a DH-1 setlist (FOLLOW DH-1 or PICK), judge settings,
      scorecard by category and preset, verdicts per repeat; engine in eh1-grader
- [ ] EH-1 next: RUN mode and quick checks, overrides, the rubric flyout
- [x] The rack: DH-1 and EH-1 side by side (fold, FULL FACE), then v3: transport, one
      panel, compact cards
- [x] The rack: chaining DH-1 into EH-1, with AUTO-GRADE for setlists
- [ ] The rack: the chain lane, Open in DH-1, rack presets
- [ ] Packaging: bundle Python with the app, signing and notarization
