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
  dh1/      the DH-1 device: its face, run state, settings, and the client for the
            agent server's protocol
apps/
  dh1/      DH-1 as a standalone app: a Tauri window (src-tauri/) around the device
```

Each plugin is a **device** (a component that takes an engine connection) inside a
thin **host** (the window chrome, theme, and engine process). A standalone app is one
host with one device; the rack will be one host with several. Each device's styles are
scoped under its own class (`.dh1`), so devices can sit side by side.

The engines are Python and live in their own repos. DH-1's is
[duckdb-analytics-agent](https://github.com/early-signal-tech/duckdb-analytics-agent).

### DH-1

```
React (packages/dh1)  ──invoke("harness_send")──▶  Rust (apps/dh1/src-tauri)  ──stdin──▶  duck-harness-serve
       ▲                                                  │                           (Python agent)
       └────────── "harness-message" events ◀─────────────┴────────── stdout ◀────────────────┘
```

- **`apps/dh1/src-tauri/src/lib.rs`** starts `duck-harness-serve` when the app opens
  and relays its JSON Lines protocol. Closing the app closes the server's input, which
  stops any runs, and the server exits.
- **`packages/dh1/src/harness.ts`** is the TypeScript client for the protocol:
  `hello()`, `run()` (with live events), and `stop()`. Its types mirror
  `duckdb_agent/serve.py` and the `EventCallback` events in `duckdb_agent/loop.py`.
- **`packages/dh1/src/Dh1.tsx`** is the face:
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
npm test           # unit tests for every package
npm run typecheck  # type-check every package and app
```

The app runs the server with `uv run --project ../duckdb-analytics-agent`, from that
folder, so it uses the agent's `.env` and writes traces to its `agent_traces.duckdb`.
To use a checkout somewhere else, set `DH1_AGENT_DIR`. If `uv` isn't on your PATH, set
`DH1_UV` to its full path. Server logs show up in the terminal, prefixed `[harness]`.

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
- [ ] Setlist
- [ ] EH-1: grades agent runs from the traces (its engine in its own repo)
- [ ] The rack: DH-1 and EH-1 side by side
- [ ] Packaging: bundle Python with the app, signing and notarization
