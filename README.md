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
  es1/      the ES-1 device: a synth-style panel over Estuary's flowctl (BUILD, connected
            up to TEST, and MAP), and the client for the bridge's protocol (cli-bridge)
apps/
  dh1/      DH-1 as a standalone app: a Tauri window (src-tauri/) around the device
  eh1/      EH-1 as a standalone app (npm run eh1), starting eh1-grader's eh1-serve
  es1/      ES-1 as a standalone app (npm run es1), starting cli-bridge's es1-serve
  rack/     the Rack (npm run rack): one window running every engine, with DH-1,
            EH-1, and ES-1 as devices in a chain
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

- **`crates/dh-host/src/engines.rs`** starts each engine the host runs (`dh1`, `eh1`, `es1`)
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

You need a Mac, Rust, Node 22+, and [uv](https://docs.astral.sh/uv/). Clone each engine
next to this repo. DH-1 needs only the agent; EH-1, ES-1 and the full Rack need theirs too:

```
Github/
  duck-harness-app/         # this repo
  duckdb-analytics-agent/   # DH-1's agent, with ANTHROPIC_API_KEY in its .env
  eh1-grader/               # EH-1's grader, with ANTHROPIC_API_KEY in its .env
  cli-bridge/               # ES-1's bridge to Estuary's flowctl
```

```bash
git clone https://github.com/early-signal-tech/duck-harness-app
git clone https://github.com/early-signal-tech/duckdb-analytics-agent
git clone https://github.com/early-signal-tech/eh1-grader
git clone https://github.com/early-signal-tech/cli-bridge
```

ES-1 also needs [flowctl](https://docs.estuary.dev/guides/get-started-with-flowctl/) on
your PATH, signed in to your own Estuary account. Instead of a .env, the API key can be saved in
Settings (the Keychain).

Then, from the repo root:

```bash
npm install
npm run dh1        # DH-1 in development (Tauri + Vite)
npm run dh1:app    # DH-1 built as a Mac app, then opened (needed for dictation)
npm run eh1        # EH-1
npm run es1        # ES-1
npm run rack       # the Rack: DH-1, EH-1, and ES-1 in one window
npm test           # unit tests for every package
npm run typecheck  # type-check every package and app
```

The host finds each engine (crates/dh-host, `discovery.rs`) in this order:

1. **A dev override:** `DH1_AGENT_DIR` (the agent), `EH1_GRADER_DIR` (the grader) or `ES1_BRIDGE_DIR` (the bridge)
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
3. **A checkout next to this repo** (`../duckdb-analytics-agent`, `../eh1-grader`, `../cli-bridge`), run
   with `uv run --project` from that folder, so it uses the checkout's `.env`.

Every engine gets the same traces file as an absolute `--traces-db`: the one chosen in
Settings, else `agent_traces.duckdb` in the agent checkout (the CLI's default too).
If `uv` isn't on your PATH, set `DH1_UV` to
its full path. Engine logs show up in the terminal, prefixed `[agent]` or `[grader]`.

## The Rack

`apps/rack` (`npm run rack`) is one window running every engine (`dh1`, `eh1`, and `es1`), laid
out like a DAW (wireframes: the "RACK v3" boards on the design canvas):

- **The transport** across the top plays the chain: the rack preset (‹ name ▾ ›), the
  prompt, what PLAY makes (RUN, A/B, or SETLIST), PLAY and STOP, then Settings and one
  **ENGINE** light: lit when the engines the chain uses are running, pulsing while they
  start, red if one is down (hover lists each engine). In SETLIST mode it shows the setlist PLAY will start (set ×
  presets × repeats, and how many runs; Edit… opens DH-1's Setlist to change it), and
  DH-1's SOURCE tile shows the setlist's data instead; while one plays, the transport
  shows its progress. The setlist draft lives in DH-1's model (`useSetlistDraft`), so the
  Setlist screen's RUN SETLIST and the transport's PLAY start the same thing.
- **The panel** shows the chain's output or, when you open a device, its full editor (✕
  goes back to the output). The output is **takes**: each press of PLAY is a take (a RUN,
  an A/B, or a SETLIST), and `TAKE n OF m ‹ ›` steps through the loaded preset's takes,
  read from the traces by the agent (`takes` / `take` requests, duckdb_agent/takes.py).
  The newest shows live while it plays; a setlist take is a questions × columns grid,
  with AUTO GRADER's grades when it graded them.
- **The rack** along the bottom holds the chain as compact cards, with + slots between
  them that offer only what fits there (`chainRules.ts`): one instrument per chain
  (DH-1, EH-1 on its own, or ES-1 on its own), and devices that take runs after one that
  gives them. ES-1 gives pipelines, which nothing takes yet.
  Click a card to select it and Delete (⌫) removes it, asking first if it's working;
  right-click a card for its menu (open, collapse, delete). A device that no longer
  fits (AUTO GRADER after DH-1 was deleted) is dashed, says why, and stays off.
  ▾ RACK, or ⌘B, folds the whole rack to a bar of chips. A card has a vertical strip (its engine light, ⤢ to
  open it), a tile per section showing its current value (a tile opens the editor at that
  section), and a few essentials (DH-1: preset, model, EFFORT, cost; EH-1: a heat map of
  the scorecard, its meters, how much is graded; ES-1: profile, login, and how many tasks
  are OK, alerting, failing, or off). Double-click a strip to collapse the
  card to just the strip; it keeps working.
- **AUTO GRADER** is a utility that wraps its own EH-1, after DH-1. Its power button is
  its switch: on, the EH-1 inside grades each setlist run as it finishes (eh1-grader's
  `follow`) with its own judge settings, and the card shows the latest grade and what it
  graded and spent. Its inner slot (or ⤢) opens that EH-1 in the panel. It starts off
  each time, and there's one per chain.

Each device is a model plus views (`useDh1` / `useEh1`, drawn by `Dh1Card` / `Eh1Card`,
`Dh1Face` / `Eh1Face`, and `Dh1Output`). ES-1 keeps its state in its own panel, so the
rack keeps that panel mounted (hidden) while ES-1 is in the chain, and `Es1Card` shows
what the panel reports (`onSummary`). The rack keeps the models, so a device keeps
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

## License

MIT. See [LICENSE](LICENSE).
