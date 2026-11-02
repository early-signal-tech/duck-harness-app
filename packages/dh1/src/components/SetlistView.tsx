// SETLIST: a question set × preset columns × repeats, as a grid. Each cell has a lamp per
// repeat and the cell's medians; the bottom row sums up each column. Pick a cell to see
// its repeats. Like Compare, it takes over the face until "Back to plugin".

import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Markdown, Menu, MenuDivider, MenuItem, MenuSection } from "@dh/ui-kit";
import {
  describeSource, FACTORY_QUESTION_SETS, parseQuestionSet, type Question, type QuestionSet,
} from "@dh/formats";
import { formatSetting } from "../ab";
import type { Preset } from "../presets";
import {
  cellJobs, cellStats, checkNote, COLUMN_KEYS, columnSummary, CONCURRENCY_CHOICES, jobCount, lampOf, loadSavedPlan,
  MAX_COLUMNS, progressOf, REPEAT_CHOICES, savePlan, type Job, type Lamp, type SavedPlan,
} from "../setlist";
import type { SetlistControls } from "../useSetlist";
import { isAnswer } from "./StructuredAnswer";

interface Props {
  setlist: SetlistControls;
  presets: Preset[];
  /** Whether the engine is up and nothing else is running on the face. */
  canStart: boolean;
  blockedReason: string | null;
  onBack: () => void;
  /** Put a cell's preset and question on the face. */
  onLoad: (preset: Preset, question: Question, set: QuestionSet) => void;
  textSize: number;
  onTextSize: (direction: 1 | -1) => void;
}

const LAMP_TEXT: Record<Lamp, string> = {
  ok: "completed", limit: "hit a limit", error: "error", run: "running", queue: "queued", skip: "stopped",
};

const money = (usd: number) => (usd >= 10 ? `$${usd.toFixed(2)}` : usd >= 0.1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(4)}`);
const pct = (fraction: number) => `±${Math.round(fraction * 100)}%`;
const secs = (s: number) => `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function presetSummary(preset: Preset): string {
  const s = preset.settings;
  return [formatSetting("model", s.model), s.effort, `${s.maxIterations} iter`].join(" · ");
}

function repeatLabel(job: Job): string {
  const lamp = lampOf(job);
  if (job.state === "done" && job.result && lamp !== "ok") return job.result.status.replace(/_/g, " ");
  if (lamp === "run") return job.iteration ? `running · iteration ${job.iteration}` : "starting";
  return LAMP_TEXT[lamp];
}

function answerOf(job: Job): string {
  if (job.error) return job.error;
  const r = job.result;
  if (!r) return "";
  if (isAnswer(r.answer)) return r.answer.summary;
  return r.text || r.error || "";
}

export function SetlistView({ setlist, presets, canStart, blockedReason, onBack, onLoad, textSize, onTextSize }: Props) {
  const { state, busy } = setlist;
  const [saved, setSaved] = useState<SavedPlan>(loadSavedPlan);
  useEffect(() => savePlan(saved), [saved]);
  const [opened, setOpened] = useState<QuestionSet[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [menu, setMenu] = useState<"set" | "column" | "concurrency" | null>(null);
  const [picked, setPicked] = useState<{ question: string; column: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const closeMenu = useCallback(() => setMenu(null), []);

  const sets = [...FACTORY_QUESTION_SETS, ...opened];
  const draftSet = sets.find((s) => s.id === saved.setId) ?? FACTORY_QUESTION_SETS[0];
  const draftColumns = saved.columnIds
    .map((id) => presets.find((p) => p.id === id))
    .filter((p): p is Preset => p !== undefined);

  // With results on screen, the grid is the plan that ran; otherwise it's the draft.
  const shown = state.plan;
  const set = shown?.set ?? draftSet;
  const columns = shown?.columns ?? draftColumns;
  const repeats = shown?.repeats ?? saved.repeats;
  const locked = state.phase !== "idle";
  const runs = jobCount({ set, columns, repeats });
  const progress = progressOf(state);

  const edit = (patch: Partial<SavedPlan>) => setSaved((p) => ({ ...p, ...patch }));

  const openSetFile = async () => {
    closeMenu();
    setProblem(null);
    const path = await open({ title: "Open a question set", filters: [{ name: "Question set", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      const loaded = parseQuestionSet(await invoke<string>("file_read", { path }));
      setOpened((list) => [...list.filter((s) => s.id !== loaded.id), loaded]);
      edit({ setId: loaded.id });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const run = () => {
    if (!canStart || !columns.length) return;
    setPicked(null);
    setlist.start({ set, columns, repeats: saved.repeats, concurrency: saved.concurrency });
  };

  const startTitle = !columns.length
    ? "Add a preset column"
    : blockedReason ?? `Run ${runs} runs, ${saved.concurrency} at a time`;

  const pickedQuestion = picked ? set.questions.find((q) => q.id === picked.question) : undefined;
  const pickedJobs = picked ? cellJobs(state, picked.question, picked.column) : [];
  const withCheck = set.questions.filter((q) => checkNote(q) === "has a check").length;
  const summaries = useMemo(() => columns.map((_, c) => columnSummary(state, c)), [state, columns]);

  return (
    <section className="panel setlist" style={{ "--pane-text": `${textSize}px`, "--columns": columns.length } as React.CSSProperties}>
      <h2 className="setlist-head">
        SETLIST
        <Menu
          open={menu === "set"}
          onClose={closeMenu}
          label="Question sets"
          anchor={
            <button className="field-button" disabled={locked} aria-haspopup="menu" onClick={() => setMenu(menu === "set" ? null : "set")}>
              {set.name} · {set.questions.length} questions{set.source ? ` · ${describeSource(set.source)}` : ""} <span aria-hidden="true">▾</span>
            </button>
          }
        >
          <MenuSection title="QUESTION SETS">
            {sets.map((s) => (
              <MenuItem key={s.id} checked={s.id === set.id} hint={`${s.questions.length} questions`} onSelect={() => { edit({ setId: s.id }); closeMenu(); }}>
                {s.name}
              </MenuItem>
            ))}
          </MenuSection>
          <MenuDivider />
          <MenuItem onSelect={() => void openSetFile()}>Open a set file…</MenuItem>
        </Menu>

        <span className="setlist-control">
          REPEAT
          <span className="stepper">
            {REPEAT_CHOICES.map((n) => (
              <button key={n} className={n === repeats ? "on" : ""} disabled={locked} onClick={() => edit({ repeats: n })} aria-label={`Repeat ${n} times`}>×{n}</button>
            ))}
          </span>
        </span>

        <Menu
          open={menu === "column"}
          onClose={closeMenu}
          label="Add a preset column"
          anchor={
            <button className="field-button" disabled={locked || columns.length >= MAX_COLUMNS} onClick={() => setMenu(menu === "column" ? null : "column")}
              title={columns.length >= MAX_COLUMNS ? `Up to ${MAX_COLUMNS} columns` : "Add a preset as a column"}>
              + PRESET COLUMN
            </button>
          }
        >
          {presets.map((p) => (
            <MenuItem key={p.id} disabled={saved.columnIds.includes(p.id)} hint={presetSummary(p)} onSelect={() => { edit({ columnIds: [...saved.columnIds, p.id] }); closeMenu(); }}>
              {p.name}
            </MenuItem>
          ))}
        </Menu>

        <Menu
          open={menu === "concurrency"}
          onClose={closeMenu}
          label="Runs at a time"
          anchor={
            <button className="field-button" disabled={locked} onClick={() => setMenu(menu === "concurrency" ? null : "concurrency")}>
              {shown?.concurrency ?? saved.concurrency} AT A TIME <span aria-hidden="true">▾</span>
            </button>
          }
        >
          {CONCURRENCY_CHOICES.map((n) => (
            <MenuItem key={n} checked={n === saved.concurrency} onSelect={() => { edit({ concurrency: n }); closeMenu(); }}>
              {n} at a time
            </MenuItem>
          ))}
        </Menu>

        <span className="setlist-count">{runs} runs</span>

        <div className="pane-tools">
          {state.phase === "done" && (
            <button className="pane-button" onClick={() => { setlist.clear(); setPicked(null); }} title="Clear the results and edit the setlist (the runs stay in the traces)">
              Clear results
            </button>
          )}
          {!busy && state.phase !== "done" && (
            <button className="run" disabled={!canStart || !columns.length} onClick={run} title={startTitle}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4l14 8-14 8z" /></svg>
              RUN SETLIST
            </button>
          )}
          {busy && (
            <button className="stop" disabled={state.phase === "stopping"} onClick={setlist.stop} title="Stop the running runs and skip the rest">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="16" height="16" /></svg>
              {state.phase === "stopping" ? "STOPPING…" : "STOP"}
            </button>
          )}
          <button className="pane-button" onClick={() => onTextSize(-1)} title="Smaller text (⌘−)" aria-label="Smaller text">A−</button>
          <button className="pane-button" onClick={() => onTextSize(1)} title="Larger text (⌘+)" aria-label="Larger text">A+</button>
          <button className="pane-button" onClick={onBack} title="Back to the plugin (Esc)">Back to plugin</button>
        </div>
      </h2>

      {problem && <p className="error setlist-problem">{problem}</p>}

      <div className="setlist-progress" aria-live="polite">
        <div className="track"><div className="fill" style={{ width: `${progress.total ? (progress.settled / progress.total) * 100 : 0}%` }} /></div>
        <span>
          {state.phase === "idle"
            ? `Not run yet. Cost shows once runs finish; the estimate firms up as each column completes a run.`
            : [
                `${progress.settled} / ${progress.total}`,
                busy ? `${progress.running} running` : state.phase === "done" ? "finished" : "",
                `${money(progress.spent)} so far`,
                progress.projected !== null && progress.settled < progress.total ? `est. ${money(progress.projected)} total` : "",
                state.startedAt ? clock((state.endedAt ?? now) - state.startedAt) : "",
              ].filter(Boolean).join(" · ")}
        </span>
      </div>

      <div className="setlist-body">
        <div className="setlist-grid-wrap">
          <table className="setlist-grid">
            <thead>
              <tr>
                <th className="q">QUESTION</th>
                {columns.map((p, c) => (
                  <th key={p.id}>
                    <span className="col-name">{COLUMN_KEYS[c]} · {p.name.replace(/ \(default\)$/, "").toUpperCase()}</span>
                    <span className="col-settings">{presetSummary(p)}</span>
                    {!locked && (
                      <button className="col-remove" aria-label={`Remove ${p.name}`} title="Remove this column"
                        onClick={() => edit({ columnIds: saved.columnIds.filter((id) => id !== p.id) })}>×</button>
                    )}
                  </th>
                ))}
                {!columns.length && <th className="muted">Add a preset column to start.</th>}
              </tr>
            </thead>
            <tbody>
              {set.questions.map((q) => (
                <tr key={q.id}>
                  <th className="q">
                    <span className="q-title">{q.id.toUpperCase()} · {q.title}</span>
                    <span className="q-note">{checkNote(q)}{q.tags.length ? ` · ${q.tags.join(", ")}` : ""}</span>
                  </th>
                  {columns.map((p, c) => {
                    const jobs = cellJobs(state, q.id, c);
                    const stats = cellStats(jobs);
                    const lamps: Lamp[] = jobs.length ? stats.lamps : Array.from({ length: repeats }, () => "queue");
                    const isPicked = picked?.question === q.id && picked.column === c;
                    const cls = stats.running ? "run" : stats.allQueued || !jobs.length ? "queue" : "done";
                    return (
                      <td key={p.id}>
                        <button
                          className={`cell ${cls}${isPicked ? " picked" : ""}`}
                          disabled={!jobs.length}
                          onClick={() => setPicked(isPicked ? null : { question: q.id, column: c })}
                          aria-label={`${q.id} with ${p.name}: ${lamps.map((l) => LAMP_TEXT[l]).join(", ")}`}
                        >
                          <span className="lamps">{lamps.map((l, i) => <i key={i} className={`lamp ${l}`} />)}</span>
                          <span className="meta">
                            {stats.running
                              ? `iter ${stats.running.iteration || "…"}`
                              : stats.medCost !== null
                                ? `${money(stats.medCost)} · ${stats.medIterations} it`
                                : !jobs.length ? "not run" : stats.allQueued ? "queued" : "—"}
                          </span>
                          {stats.spread !== null && <span className="spread">{pct(stats.spread)}</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th className="q">SUMMARY</th>
                {columns.map((p, c) => {
                  const s = summaries[c];
                  return (
                    <td key={p.id}>
                      <span className="sum-main">completed {s.completed}/{s.total || set.questions.length * repeats}</span>
                      <span>{money(s.totalCost)}{s.medCost !== null ? ` · med ${money(s.medCost)}` : ""}</span>
                      <span>
                        {[s.medIterations !== null ? `med ${s.medIterations} it` : "", s.medSeconds !== null ? `med ${secs(s.medSeconds)}` : ""]
                          .filter(Boolean).join(" · ") || "—"}
                      </span>
                      <span>
                        {[s.spread !== null ? `spread ${pct(s.spread)}` : "", `${s.limits} hit limits`, `${s.errors} errors`].join(" · ")}
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>

          <p className="setlist-check">
            <span className="caps">CHECK</span>
            {withCheck} of {set.questions.length} questions carry a check. Grading happens in EH-1 (coming): every run here is
            labelled with its setlist, question, preset column, and repeat.
          </p>
        </div>

        {picked && pickedQuestion && (
          <aside className="setlist-cell">
            <h3>
              <span className="caps muted">CELL</span>
              <button className="pane-button" onClick={() => setPicked(null)} aria-label="Close">×</button>
            </h3>
            <p className="cell-q">{pickedQuestion.id.toUpperCase()} · {pickedQuestion.title}</p>
            <p className="caps muted">{COLUMN_KEYS[picked.column]} · {columns[picked.column]?.name} · {pickedJobs.length} repeats</p>
            <p className="cell-prompt">“{pickedQuestion.prompt}”</p>
            {pickedJobs.map((job) => (
              <details key={job.index} className="repeat" open={pickedJobs.length === 1}>
                <summary>
                  <i className={`lamp ${lampOf(job)}`} />
                  <span className="label">#{job.repeat} · {repeatLabel(job)}</span>
                  {job.result && (
                    <span className="meta">
                      {job.result.estimated_cost_usd != null ? `${money(job.result.estimated_cost_usd)} · ` : ""}
                      {job.result.iterations} it · {secs(job.result.duration_ms / 1000)}
                    </span>
                  )}
                </summary>
                <div className="repeat-answer">
                  {answerOf(job) ? <Markdown text={answerOf(job)} /> : <p className="faint">No answer yet.</p>}
                  {job.result && <p className="faint selectable">{job.result.run_id}</p>}
                </div>
              </details>
            ))}
            <div className="cell-actions">
              <button
                className="pane-button"
                disabled={!columns[picked.column]}
                title="Put this preset and question (and its data) on the face"
                onClick={() => onLoad(columns[picked.column], pickedQuestion, set)}
              >
                Load this preset and question
              </button>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
