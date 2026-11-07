# DH-1 UI requests

Requests for the face, triaged. Statuses: **ready** (clear and feasible, can be built
now), **needs info** (a question to settle first), **later** (waits on a panel that
doesn't exist yet), **done**.

When a request is built, mark it done with the PR number rather than deleting it.

## Open

### 1. Pop out the Answer or Activity pane — expand done (PR #2), separate window later
- Two ways to do this:
  - **(a) Expand in place:** the pane fills the window, with Esc or a button to go
    back. This is the wireframe's "Expand ↗". Small.
  - **(b) A separate window:** the pane opens in its own native window that can be
    moved to another monitor while the main face keeps running. Feasible with Tauri,
    but the second window needs the live run state streamed to it, so it's a bigger
    job.
- Decided: build (a) now. (b) comes later, once there's more live state worth
  watching from a second screen (timeline, compressor).
- Priority: **3**.

## Done

### 5. The rack: one way to start a setlist — done (rack PR 5b)
With SETLIST picked, the transport's ▶ PLAY only opened DH-1's Setlist, and the real start
was RUN SETLIST inside it.

- The setlist draft (set, preset columns, repeats, concurrency, name, note) now lives in
  DH-1's model, so the transport's PLAY starts it; the transport shows what it will start
  (and how many runs), with Edit… to open DH-1's Setlist. RUN SETLIST starts the same thing.

### 6b. The rack: SOURCE in SETLIST mode — done (rack PR 5b)
In SETLIST mode, DH-1's card shows SETLIST DATA (the question set's data, e.g.
`TPC-H 0.01`) in place of SOURCE.

### 6. The rack: small fixes seen while trying it — done (rack PRs 3 and 4, #33 and #34)
- "Back to plugin" now says **Back to DH-1** / **Back to EH-1** (everywhere: it goes back
  to the device's face).
- DH-1's card shows a ● for an edited preset outside the name, so a long name can't hide it.
- Selected and open are dark grey, not blue (#33).

### 7. The rack: Settings opened off the top of the window — done (rack PR 3, #33)
The rule that makes the rack's menus open upward also matched the app's root (both were
`.rack`), so every menu, Settings included, opened upward. The rack's section is now
`.rack-dock`.


### 4. Activity says when the run has ended — done (PR #2)
With Activity expanded, nothing else is visible, so there was no way to tell the
answer had arrived.

- Every run now ends with a closing Activity line: "Answer ready", "Run stopped",
  "Run ended … no answer", or "Couldn't run". It shows the iterations, time, and cost,
  plus the error when there is one.
- While Activity is expanded, that line has a "Show answer →" button that switches the
  expanded view to the answer.
- The log follows new lines, unless you've scrolled up to read something.
- Also fixed along the way: SQL and thinking boxes now cut cleanly after three lines
  (ending in "…" with a dashed edge), and a click shows the whole text. "1 rows" now
  reads "1 row".

### 3. Drag to resize the Activity and Answer panes — done (PR #2)
A handle where the two panes meet, dragged left or right to trade width between them.

- Feasible now with no new dependencies.
- Plan: a vertical splitter between the panes. Each pane has a minimum width so
  neither can collapse to nothing. Double-clicking the handle resets the split. The
  split is remembered between launches, like the theme.
- Priority: **1**. It's small, and it decides how the bottom of the face is laid out.

### 2. Larger, adjustable text in the Activity and Answer panes — done (PR #2)
The text in both panes should be more legible.

- Today Activity is 11px and Answer is 12px, both monospace, copied from the
  wireframe's sizes.
- Plan:
  - Raise the default sizes.
  - Add a text-size control for the two panes: A− / A+ in each pane's header, plus
    ⌘+ / ⌘− / ⌘0 shortcuts.
  - Remember the size between launches.
  - Optionally use Inter (the prose font) for the answer and keep monospace for SQL,
    tables, and values. Monospace is harder to read at length.
- Decided: answer prose in Inter; SQL, code, and tables stay monospace.
- Priority: **2**.
