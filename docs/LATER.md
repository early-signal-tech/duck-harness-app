# Later

Good ideas that are parked on purpose, so they aren't lost and aren't half-built. Each
one says why it waits and what it depends on. When one is picked up, move it to a PR
(and to [UI_REQUESTS.md](UI_REQUESTS.md) if it's a UI change) and delete it here.

**The rule:** one plugin gets finished before the next one starts. DH-1 first, then
EH-1, then the rack.

## Saved prompts / test cases
A prompt you like, on a dataset, with the settings, that you can run again or hand to
someone else.

- **Not in presets.** A preset is how the plugin is set up and is reused across
  questions. If presets held prompts, switching presets to compare would replace the
  question you just typed.
- **Where it belongs:** a saved question (prompt + source, maybe an expected answer)
  is a test case. That's the Setlist / EH-1 side.
- Depends on: EH-1's design (how questions and checks are stored).

## Re-run from history
Open a past run and run it again: same prompt, source, and settings.

- Every run's prompt, source, full settings, preset, and answer are already in the
  traces (`agent_runs`), so nothing is lost by waiting.
- Belongs in the trace browser (the wireframe's "Traces ▾" button), which isn't designed
  yet.
- Depends on: a trace browser design; EH-1 will need one too, so design it once for both.

## Share a run
Send someone a run (question, settings, answer, the SQL it ran) to look at or replay.

- Could be an export of one run's traces, plus "open in DH-1" to load its settings.
- Depends on: re-run from history.

## A lite version of DH-1
Fewer features for people who don't need every knob.

- **Option 1, a Simple / Advanced switch in DH-1** (about half a day). Simple hides
  the compressor and the advanced knobs. Hidden knobs still apply from the loaded
  preset or the defaults, so a preset behaves the same in either mode.
- **Option 2, a separate "DH-1 Lite" app** (about a day, plus packaging). A thin
  host (`apps/dh1-lite`) renders the same device locked to Simple. It shares presets,
  and can tag runs with `labels: {"edition": "lite"}`.
- **Option 3, a separate lite device** with its own compact layout. Only worth it if
  lite should look clearly different.
- Decide by audience: new users point to option 1; a free tier or separate product
  points to option 2, built on option 1's split.
- Ongoing cost: each new feature needs an in-or-out decision, and options 2 and 3 mean
  testing two builds.

## Right-click menu on knobs
The wireframe's knob menu: Reset to default, Enter value…, Lock when changing presets,
Sweep in Setlist…, What does this do?

- Right-clicking a knob today shows the webview's own Reload / Inspect Element menu.
- Reset and Enter value are small. Lock needs presets to skip locked knobs. Sweep
  depends on the Setlist.

## Replay SQL
The wireframe's timeline has a "Replay SQL" button: re-run one of the agent's queries
and see the full result, not just what Claude was shown.

- Needs a new request in the agent server (`query`: run read-only SQL on a run's
  source and return rows), plus a results view in DH-1.
- The traces already keep every query exactly as sent (`agent_traces.sql_query`, and
  the `replay_sql` view), so the SQL is there.

## Pop out a pane into its own window
The second half of UI request 1 (expand-in-place shipped). A real window you can move
to another monitor.

- Needs the live run state streamed to a second window.
- Worth doing once there's more live state to watch (timeline, compressor).

## A power button on each rack device
The wireframe's title bar has power, like an Ableton device's on/off.

- What "off" means isn't decided. For EH-1 it could be "stop following the chain" (no
  auto-grade, no new setlists picked up). For DH-1 there's no obvious meaning: a device
  with nothing upstream has nothing to bypass.
- Depends on: the chain (rack PR 5), which is what EH-1's power would switch off.

## Shared face state (rule 4)
Each device's current knob positions live in the app's browser storage, so the
standalone apps and the rack each keep their own. The rack opened with EH-1 on the
Sonnet judge while the standalone EH-1 was on Haiku, so a setlist graded there showed
"0 graded with these settings".

- Presets, question sets, setlists and grades are already shared (files in the app data
  folder, rows in the traces). Only "where the knobs are right now" isn't.
- Fix: a small per-device current-state file in the app data folder
  (`~/Library/Application Support/Duck Harness/State/<device>.json`), read and written
  by every host through dh-host, in place of localStorage for device settings. Window
  layout (rack folds, pane widths, text size) can stay per app.
- That makes it something the CLI can read too ("grade with the judge I last used").

## Several chains in the rack
A narrow column of chains on the left, like Bitwig's track headers: each with its name,
what's in it, its status, and ▶ / ■. Select one and its rack loads below and its takes
show above; a chain keeps playing when you select another.

- Wireframes: boards 18–19 ("RACK v3 · chains and takes").
- For now the rack holds one chain, saved and loaded as a rack preset (board 20).
- Open questions when it's picked up: whether a chain remembers what it plays (its prompt
  or setlist) so its own ▶ replays it, and how chains are renamed and reordered.
- Depends on: the single-chain rack (rack presets, takes) being built first.

## Run on the face while a setlist runs
For now a setlist has the engine to itself: RUN and RUN A+B are disabled while it's going,
so its timings and costs aren't skewed by other runs competing for API capacity.

- Later: let RUN work alongside it (the engine can already handle concurrent runs),
  with the header chip showing the setlist is still going.
- Probably a toggle, since clean timing data is the reason to keep it exclusive.

## MotherDuck as a source
Connect a MotherDuck account and query its databases with the same SQL as local DuckDB.

- **Blocked:** the MotherDuck extension doesn't load on DuckDB 2.0.0 yet ("not yet
  supported by MotherDuck. The latest supported version is v1.5.6", checked
  2026-11-03). The agent and traces need 2.0 (VARIANT columns, the Quack server), so
  going back to 1.5 isn't an option.
- **Once it's supported, it's small:** LINE IN already attaches any path read-only, so
  `md:my_db` should mostly just work. Left to do:
  - a MotherDuck token in Settings, kept in the Keychain like the API key and passed to
    the agent as `MOTHERDUCK_TOKEN`
  - checking that a read-only attach works on MotherDuck
  - a Handbook section
- Waiting for: MotherDuck support for DuckDB 2.0, and someone asking for it.

## Preload table schemas from the face
Give the agent the chosen tables' `DESCRIBE` output in its first message, so it skips
the discovery calls.

- **The agent already does this:** its `tables` option, used by question sets (the
  analytics eval preloads `events_rich_ml_gold`). DH-1's face never sends it, so face
  runs from LINE IN and SAMPLER always start with `list_tables` and `describe_table`.
- **What the traces suggest** (2026-11-03; different questions, so not a fair comparison):

  | Runs | Discovery calls per run | Tool calls | Iterations |
  |---|---|---|---|
  | Analytics eval, preloaded | ~0 | 3.1 | 3.1 |
  | TPC-H setlists, not preloaded | 1 list + 1.6 describe | 5.2 | 4.0 |
  | Face runs, not preloaded | 0.8 list + 2.4 describe | 9.4 | 4.9 |

  Discovery is about 2–3 tool calls and one iteration per run. The cost is context:
  wide tables, or many of them (TPC-H has 8), are re-sent on every turn.
- **Shape when picked up:** after LINE IN connects or SAMPLER loads, SOURCE lists the
  tables as chips to tick for preloading, with none ticked by default. Possibly also a
  preset setting (none / ticked / all tables), so a setlist can compare preloading
  against not preloading on the same questions and EH-1 grades both.
- Waiting for: someone asking for it. It's extra UI before there's a need.

## Drawers on rack cards
Clicking a card's tile slides a few of that section's controls out inside the card
(like Poly Grid's drawers), instead of opening the full editor in the top panel. Drawn
on the design canvas, boards 14–15 (DH-1's COMPRESSOR drawer: on/off, threshold, gain
reduction).

- **Skipped for now** (2026-11-08). Tiles open the device's editor in the panel.
- **What it would fix:** tweaking a setting without losing the take. Today opening an
  editor replaces the take in the panel.
- **Why not yet:**
  - it repeats editor controls in a second place (see "Shared face state")
  - a widening card pushes the rest of the rack sideways
  - only a handful of settings change mid-session: compressor on/off and threshold,
    the iteration limit, judge model and effort, tolerance
- **Likely better first:** split the panel when an editor opens (editor beside the
  current take), so the take stays in view for every device without duplicating
  controls. If drawers come back, add them only for the settings people change
  mid-session.
- Waiting for: the split panel, or a mid-session tweak that still feels too heavy without one.

## Creating derivations in ES-1
A module on ES-1's BUILD panel for making derivations, between COLLECTION and
MATERIALIZATION.

- **Left out for now** (2026-11-08). BUILD creates sources, collections and
  materializations. Existing derivations still show in MAP.
- **Why it's bigger than the other modules:** a derivation needs code (SQL, TypeScript or
  Python) and shuffle keys, so most of it can't be a knob or a switch.
- Waiting for: the three BUILD modules working end to end, and someone asking for it.

## Previewing tasks in ES-1
A PREVIEW control running `flowctl preview` before publishing.

- **Left out for now** (2026-11-08). A source-only preview isn't worth having: DISCOVER,
  TEST and READ already cover that path. A materialization preview writes to the real
  destination, and works through all historical data unless it's given a fixture.
- Waiting for: a safe way to preview a materialization, or a real need for a source preview.

## Dictation into the prompt
Speak a question into DH-1's prompt instead of typing it.

- **Try first, nothing to build:** macOS dictation should already work in the prompt box
  (it's a standard text field in the WebKit view). Click into the prompt, press the
  dictation shortcut (🌐/Fn twice by default), speak, then Enter. Not yet tested in the
  Tauri app.
  - Enter while the spoken words are still underlined finishes them rather than running
    (#48). Press Enter again to run.
  - Esc cancels dictation but is also DH-1's STOP, so it will stop a run in progress.
  - Dictation usually ends with a full stop; harmless in a question.
- **Column names matter less than they seem:** "L extended price" for `l_extendedprice`
  is fine, since the agent looks up the schema before writing SQL. Unusual names and exact
  values (IDs) are where dictation will slip.
- **If system dictation isn't enough, then native speech in dh-host** (Apple's on-device
  speech recognition, or a local Whisper model), which allows:
  - **push-to-talk from MIDI:** hold a pad to talk, release and the text lands in the
    prompt, then PLAY. Fits after the MIDI first build (DEVICE_SPEC §13).
  - vocabulary hints: the source's table and column names
- **Not the web speech API:** in an embedded WebKit view it's unreliable and needs extra
  microphone and speech permissions.
- Waiting for: a few days of system dictation, and the MIDI first build.
