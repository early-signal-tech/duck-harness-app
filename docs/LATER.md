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

## EH-1, the evaluator
Grades agent runs from the traces. Its engine lives in its own repo; its UI is a device
in this repo.

- Next step when DH-1 is filled out: a wireframe artboard for what it measures and how
  pass/fail is decided (reference SQL from EVAL_QUESTIONS.md / TPCH_QUESTIONS.md, a
  judge model, or by hand).

## The rack
DH-1 and EH-1 side by side in one window, like an Ableton device chain.

- Also decides the device size question: fixed-size devices that can fold to a title
  bar, versus faces that stretch.
- Depends on: EH-1.
