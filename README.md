# DH-1 (Duck Harness 1)

A desktop app for running and evaluating the
[DuckDB analytics agent](https://github.com/early-signal-tech/duckdb-analytics-agent),
laid out like an audio plugin: knobs on the front, deeper settings in flyouts, and
presets you can save and compare.

Built with [Tauri](https://tauri.app): a native macOS window (the system WebKit view,
no Electron) with a React + TypeScript UI. The agent itself stays in Python and runs as
a child process.

## How it fits together

```
React UI (src/)  ──invoke("harness_send")──▶  Rust (src-tauri/)  ──stdin──▶  duck-harness-serve
     ▲                                             │                       (Python agent)
     └──────── "harness-message" events ◀──────────┴──────── stdout ◀─────────────┘
```

- **`src-tauri/src/lib.rs`** starts `duck-harness-serve` when the app opens and relays
  its JSON Lines protocol. Closing the app closes the server's input, which stops any
  runs, and the server exits.
- **`src/harness.ts`** is the TypeScript client for the protocol: `hello()`, `run()`
  (with live events), and `stop()`. Its types mirror `duckdb_agent/serve.py` and the
  `EventCallback` events in `duckdb_agent/loop.py`.
- **`src/App.tsx`** is a test bench for now: source, effort, prompt, RUN/STOP, cost and
  iteration readouts, the event log, and the answer. The plugin face replaces it.

## Development

You need Rust, Node 22+, and [uv](https://docs.astral.sh/uv/). Clone the agent repo next
to this one:

```
Github/
  duckdb-analytics-agent/   # with ANTHROPIC_API_KEY in its .env
  duck-harness-app/
```

Then:

```bash
npm install
npm run tauri dev
```

The app runs the server with `uv run --project ../duckdb-analytics-agent`, from that
folder, so it uses the agent's `.env` and writes traces to its `agent_traces.duckdb`.
To use a checkout somewhere else, set `DH1_AGENT_DIR`. If `uv` isn't on your PATH, set
`DH1_UV` to its full path. Server logs show up in the terminal, prefixed `[harness]`.

## Status

- [x] Tauri app with the Python agent server as a child process
- [x] TypeScript protocol client and a test bench
- [ ] Plugin face: model switch, Effort and Iterations knobs, cost LCD, iteration LEDs
- [ ] Context compressor, run timeline, presets, A/B compare, Setlist
- [ ] Packaging: bundle Python with the app, signing and notarization
