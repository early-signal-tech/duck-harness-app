// The EH-1 device's face: grade a DH-1 setlist. INPUT picks the setlist (FOLLOW DH-1:
// always the newest; PICK: any); SCORES says where each score comes from; JUDGE sets the
// judge; METERS sum it up. GRADE SETLIST grades what isn't graded yet with these
// settings, and the scorecard shows questions (by category) × preset columns. Pick a cell
// for its repeats' verdicts (and your override). RUN mode (RunView) grades one run at a time.
//
// It draws a model (useEh1), which holds the settings, setlists, grades, and grading, so
// other views (the rack's compact card, AUTO GRADER) can show the same device. `Eh1` is
// the whole device: a model and its face.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { describeSource, hasCheck } from "@dh/formats";
import { Menu, MenuItem } from "@dh/ui-kit";
import type { ChainControl } from "./chain";
import { EfficientFlyout, RubricFlyout } from "./Flyouts";
import { HelpView } from "./HelpView";
import { setlistTitle, suggestedTitle } from "./picker";
import { RunView } from "./RunView";
import {
  avg, carefulOf, columnsOf, columnSummary, correctOf, JUDGE_EFFORTS, JUDGE_MODELS, scorecard, TOLERANCES, type Cell,
} from "./scorecard";
import { RenameForm, SetlistPicker } from "./SetlistPicker";
import type { EngineConnection } from "./useEngine";
import { money, useEh1, type Eh1Model } from "./useEh1";
import { GradeVerdict } from "./Verdict";
import "./eh1.css";

type View = "setlist" | "run";

const fmt = (n: number | null, digits = 1) => (n === null ? "–" : n.toFixed(digits));

/** Two segments per score, filled by its average (0–2). */
function Bars({ cell }: { cell: Cell }) {
  return (
    <span className="score-bars" aria-hidden="true">
      {[cell.correct, cell.careful, cell.efficient].map((v, i) => (
        <span key={i} className="score-bar">
          <i className={v === null ? "" : v >= 1 ? "on" : v >= 0.5 ? "half" : ""} />
          <i className={v === null ? "" : v >= 2 ? "on" : v >= 1.5 ? "half" : ""} />
        </span>
      ))}
    </span>
  );
}

function Meter({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="eh1-meter">
      <div className="eh1-meter-bar"><div className="fill" style={{ height: `${value === null ? 0 : (value / 2) * 100}%` }} /></div>
      <span className="caps">{label}</span>
      <span className="small">{fmt(value)}</span>
    </div>
  );
}

/** The whole device: its model and its face. */
export function Eh1({ engine, toolbar, chain }: {
  engine: EngineConnection;
  toolbar?: HTMLElement | null;
  /** Set when EH-1 sits in a chain (the rack), after DH-1. */
  chain?: ChainControl;
}) {
  const model = useEh1(engine, chain);
  return <Eh1Face model={model} toolbar={toolbar} chained={!!chain} />;
}

/** EH-1's face. `chained`: it sits in a chain, so FOLLOW DH-1 reads FOLLOW CHAIN. */
export function Eh1Face({ model, toolbar, chained = false }: { model: Eh1Model; toolbar?: HTMLElement | null; chained?: boolean }) {
  const {
    client, hello, ready, grader, setGrader, mode, setMode, sets, reloadSets, setlists, refreshSetlists, setPickedId,
    setlist, set, revisionMismatch, setOf, grades, graderKey, grading, progress, regrade, setRegrade, grade, problem, notice,
  } = model;

  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem("eh1.view") === "run" ? "run" : "setlist";
    } catch {
      return "setlist";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("eh1.view", view);
    } catch {
      // ignore
    }
  }, [view]);

  const [help, setHelp] = useState(false);
  const closeHelp = () => setHelp(false);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => setRenaming(false), [setlist?.id]);
  const rename = async (name: string, note: string) => {
    if (await model.rename(name, note)) setRenaming(false);
  };
  const stop = model.stopGrading;

  // Scorecard.
  const columns = columnsOf(setlist, grades);
  const groups = useMemo(() => (set ? scorecard(set, grades, columns) : []), [set, grades, columns]);
  const [picked, setPicked] = useState<{ question: string; column: string } | null>(null);
  const pickedRow = picked ? groups.flatMap((g) => g.rows).find((r) => r.question.id === picked.question) : undefined;
  const pickedCell = pickedRow && picked ? pickedRow.cells[columns.indexOf(picked.column)] : undefined;
  const saveOverride = model.saveOverride;
  const regradeCell = model.regradeCell;

  // Getting grades out.
  const [exportMenu, setExportMenu] = useState(false);
  const exportCsv = model.exportCsv;
  const openShell = model.openShell;

  const ungraded = setlist ? Math.max(0, setlist.runs - grades.length) : 0;
  const judgeModel = JUDGE_MODELS.find((m) => m.id === grader.judge_model)?.label ?? grader.judge_model;
  const withCheck = set ? set.questions.filter(hasCheck).length : 0;

  const header = (
    <div className="eh1-header">
    <div className="bar-group eh1-modes" role="radiogroup" aria-label="What to grade">
      <button role="radio" aria-checked={view === "setlist"} className={view === "setlist" ? "on" : ""} onClick={() => setView("setlist")}>SETLIST</button>
      <button role="radio" aria-checked={view === "run"} className={view === "run" ? "on" : ""} onClick={() => setView("run")}>RUN</button>
    </div>
    <button className="bar-button help-open" aria-pressed={help} onClick={() => setHelp(!help)} title="The EH-1 handbook: every feature, briefly">
      Handbook
    </button>
    </div>
  );

  return (
    <div data-device="eh1" className="eh1">
      {toolbar ? createPortal(header, toolbar) : <div className="bar">{header}</div>}

      {help ? (
        <HelpView onBack={closeHelp} />
      ) : view === "run" ? (
        <RunView engine={client} ready={ready} sets={sets} onSetsChanged={reloadSets} grader={grader} setGrader={setGrader} />
      ) : (<>

      <div className="eh1-row">
        <section className="panel eh1-input">
          <h2>INPUT</h2>
          <div className="segmented" role="radiogroup" aria-label="Which setlist">
            <button role="radio" aria-checked={mode === "follow"} className={mode === "follow" ? "on" : ""} onClick={() => setMode("follow")}>{chained ? "FOLLOW CHAIN" : "FOLLOW DH-1"}</button>
            <button role="radio" aria-checked={mode === "pick"} className={mode === "pick" ? "on" : ""} onClick={() => setMode("pick")}>PICK</button>
          </div>
          {mode === "follow" ? (
            <div className="eh1-setlist">
              <span className="title">{setlist ? setlistTitle(setlist, set?.name) : "No setlists yet"}{setlist && <span className="tag">LATEST</span>}</span>
              {!setlist && <span className="sub">Run one in DH-1's Setlist.</span>}
            </div>
          ) : (
            <>
              <SetlistPicker setlists={setlists} selected={setlist} setOf={setOf} onPick={setPickedId}
                onRename={() => setRenaming(true)} onOpen={() => void refreshSetlists()} />
            </>
          )}
          {renaming && setlist ? (
            <RenameForm key={setlist.id} setlist={setlist} suggested={suggestedTitle(setlist, set?.name)}
              onSave={rename} onCancel={() => setRenaming(false)} />
          ) : (
            <>
          {setlist && (
            <div className="id-row">
              <span className="sub selectable" title={setlist.id}>{setlist.id}</span>
              <button className="link-button" onClick={() => setRenaming(true)} disabled={!ready}>Rename…</button>
            </div>
          )}
          {setlist?.note && <span className="note">“{setlist.note}”</span>}
          <dl className="facts">
            <dt>QUESTION SET</dt>
            <dd className={revisionMismatch ? "changed" : undefined}
              title={revisionMismatch ? `The question set has changed since this setlist ran (revision ${setlist?.revision}); grading uses revision ${set?.revision}.` : undefined}>
              {set ? `${set.name} · r${set.revision}${revisionMismatch ? ` · ran r${setlist?.revision}` : ""}` : setlist ? `${setlist.question_set} (not found)` : "–"}
            </dd>
            <dt>DATA</dt><dd>{set?.source ? describeSource(set.source) : "–"}</dd>
            <dt>RUNS</dt><dd>{setlist ? `${setlist.completed}/${setlist.runs} completed` : "–"}</dd>
            <dt>WITH A CHECK</dt><dd>{set ? `${withCheck} / ${set.questions.length}` : "–"}</dd>
          </dl>
          {setlist && !set && <p className="warn">This setlist's question set isn't in BUILT-IN or MINE. Open it in DH-1's Setlist first.</p>}
            </>
          )}
        </section>

        <section className="panel eh1-scores">
          <h2>SCORES · 0–2 EACH
            <span className="h2-tools"><RubricFlyout scale={hello?.scale} grader={grader} disabled={!!grading} onApply={setGrader} /></span>
          </h2>
          {[
            ["CORRECT", "Facts match the reference SQL's results", "JUDGE + SQL"],
            ["CAREFUL", grader.instructions?.trim() ? "States the assumptions and caveats needed · with your notes" : "States the assumptions and caveats needed", "JUDGE"],
            ["EFFICIENT", `Iterations (budget ${grader.iteration_budget}), waste (1 point at ≤ ${grader.waste_for_one ?? 2}), limits`, "TRACES · FREE"],
            ["TRACE RULES", "Pass/fail checks on what the run did", "TRACES · FREE"],
          ].map(([name, what, by]) => (
            <div key={name} className="score-row">
              <span className="caps">{name}</span>
              <span className="what">{what}</span>
              <span className="row-end">
                {name === "EFFICIENT" && <EfficientFlyout grader={grader} disabled={!!grading} onApply={setGrader} />}
                <span className={`by${by.includes("FREE") ? " free" : ""}`}>{by}</span>
              </span>
            </div>
          ))}
        </section>

        <section className="panel eh1-judge">
          <h2>JUDGE</h2>
          <div className="segmented" role="radiogroup" aria-label="Judge model">
            {JUDGE_MODELS.map((m) => (
              <button key={m.id} role="radio" aria-checked={grader.judge_model === m.id} className={grader.judge_model === m.id ? "on" : ""}
                disabled={!!grading} onClick={() => setGrader({ ...grader, judge_model: m.id })}>{m.label}</button>
            ))}
          </div>
          <span className="caps muted">EFFORT</span>
          <div className="segmented" role="radiogroup" aria-label="Judge effort">
            {JUDGE_EFFORTS.map((e) => (
              <button key={e} role="radio" aria-checked={grader.judge_effort === e} className={grader.judge_effort === e ? "on" : ""}
                disabled={!!grading} onClick={() => setGrader({ ...grader, judge_effort: e })}>{e.toUpperCase()}</button>
            ))}
          </div>
          <span className="caps muted">TOLERANCE</span>
          <div className="segmented" role="radiogroup" aria-label="Tolerance">
            {TOLERANCES.map((t) => (
              <button key={t} role="radio" aria-checked={grader.tolerance === t} className={grader.tolerance === t ? "on" : ""}
                disabled={!!grading} onClick={() => setGrader({ ...grader, tolerance: t })}>{t}</button>
            ))}
          </div>
          <span className="hint">Changing the judge makes new grades; the old ones stay in the traces.</span>
        </section>

        <section className="panel eh1-meters">
          <h2>METERS</h2>
          <div className="eh1-meter-row">
            <Meter label="COR" value={avg(grades.map(correctOf))} />
            <Meter label="CAR" value={avg(grades.map(carefulOf))} />
            <Meter label="EFF" value={avg(grades.map((g) => g.efficient))} />
          </div>
          <div className="display">
            <span className="caps">JUDGE COST</span>
            <span className="display-value">{money(grades.reduce((s, g) => s + (g.judge_cost_usd ?? 0), 0))}</span>
          </div>
          <div className="graded">
            <div className="caps row-between"><span>GRADED</span><span>{grades.length} / {setlist?.runs ?? 0}</span></div>
            <div className="track"><div className="fill" style={{ width: `${setlist?.runs ? (grades.length / setlist.runs) * 100 : 0}%` }} /></div>
          </div>
        </section>
      </div>

      <div className="panel eh1-gradebar">
        <span className="caps">GRADE</span>
        <span className="what">
          {grading && progress ? `Grading ${progress.done} / ${progress.total} with ${judgeModel}…`
            : !setlist ? "No setlist to grade."
            : !set ? "Its question set isn't available."
            : `${setlist.runs} runs · ${grades.length} graded with these settings${ungraded ? ` · ${ungraded} to grade with ${judgeModel}` : ""}`}
        </span>
        <label className="regrade"><input type="checkbox" checked={regrade} disabled={!!grading} onChange={(e) => setRegrade(e.currentTarget.checked)} />Regrade all</label>
        {grading ? (
          <button className="stop" onClick={stop}>STOP</button>
        ) : (
          <button className="run" disabled={!ready || !setlist || !set || (!ungraded && !regrade)} onClick={grade}
            title={!ready ? "The grader isn't running" : !ungraded && !regrade ? "Everything is graded with these settings" : undefined}>
            ▶ GRADE SETLIST
          </button>
        )}
      </div>

      {(problem || notice) && <p className={problem ? "error eh1-message" : "eh1-message"}>{problem ?? notice}</p>}

      <div className="eh1-bottom">
        <section className="panel eh1-scorecard">
          <h2>
            SCORECARD
            <span className="legend">each cell: CORRECT · CAREFUL · EFFICIENT averaged over repeats · <i className="rule-dot" /> a trace rule broke</span>
            <Menu open={exportMenu} onClose={() => setExportMenu(false)} label="Export" align="right"
              anchor={<button className="pane-button" aria-haspopup="menu" disabled={!setlist || !set} onClick={() => setExportMenu(!exportMenu)}>EXPORT ▾</button>}>
              <MenuItem disabled={!grades.length} hint={`${grades.length} rows`} onSelect={() => { setExportMenu(false); void exportCsv(); }}>Export scorecard as CSV…</MenuItem>
              <MenuItem disabled={!graderKey} onSelect={() => { setExportMenu(false); void openShell(); }}>Open grades in DuckDB shell</MenuItem>
            </Menu>
          </h2>
          {!set ? <p className="muted">{setlist ? "No question set for this setlist." : "No setlist yet."}</p> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th className="q">QUESTION</th>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <GroupRows key={group.category?.id ?? "-"} group={group} columns={columns} picked={picked} onPick={setPicked} />
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th className="q">SUMMARY</th>
                    {columns.map((c) => {
                      const s = columnSummary(grades, c);
                      return (
                        <td key={c}>
                          <b>{fmt(s.total)} / 6 avg</b>
                          <span>{s.fullMarks}/{s.graded} full marks</span>
                          <span>{s.costPerFullMarks === null ? "no full marks yet" : `${money(s.costPerFullMarks)} per full-marks answer`}</span>
                          {s.rulesBroken > 0 && <span className="bad">{s.rulesBroken} rule{s.rulesBroken === 1 ? "" : "s"} broken</span>}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {picked && pickedRow && pickedCell && (
          <aside className="panel eh1-verdict">
            <h2>VERDICT <button className="pane-button" onClick={() => setPicked(null)} aria-label="Close">×</button></h2>
            <p className="q-title">{pickedRow.question.id} · {pickedRow.question.title}</p>
            <p className="caps muted">COLUMN {picked.column} · {pickedCell.grades.length} repeat{pickedCell.grades.length === 1 ? "" : "s"}</p>
            {pickedCell.grades.length === 0 && <p className="muted">Not graded with these settings yet.</p>}
            {pickedCell.grades.map((g) => (
              <GradeVerdict
                key={g.run_id}
                grade={g}
                heading={`#${g.repeat ?? 1} · ${g.status.replace(/_/g, " ")}`}
                busy={!!grading}
                onOverride={(value) => saveOverride(g.run_id, value)}
              />
            ))}
            {pickedCell.grades.length > 0 && (
              <div className="verdict-actions">
                <button className="pane-button" disabled={!!grading || !ready} onClick={() => regradeCell(pickedCell.grades.map((g) => g.run_id))}
                  title="Ask the judge again for this cell's repeats; your overrides stay">
                  Regrade this cell
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
      </>)}
    </div>
  );
}

function GroupRows({ group, columns, picked, onPick }: {
  group: ReturnType<typeof scorecard>[number];
  columns: string[];
  picked: { question: string; column: string } | null;
  onPick: (p: { question: string; column: string } | null) => void;
}) {
  return (
    <>
      {group.category && (
        <tr className="category-row">
          <th className="q">{group.category.id} · {group.category.name.toUpperCase()}</th>
          {group.cells.map((cell, i) => (
            <td key={i}><span className="cat-total">{cell.total === null ? "–" : `${cell.total.toFixed(1)}/6`}{cell.rulesBroken > 0 && <i className="rule-dot" />}</span></td>
          ))}
        </tr>
      )}
      {group.rows.map((row) => (
        <tr key={row.question.id}>
          <th className="q"><span className="q-title">{row.question.id} · {row.question.title}</span></th>
          {row.cells.map((cell, i) => {
            const isPicked = picked?.question === row.question.id && picked.column === columns[i];
            return (
              <td key={i}>
                <button
                  className={`cell${cell.grades.length ? "" : " empty"}${isPicked ? " picked" : ""}`}
                  onClick={() => onPick(isPicked ? null : { question: row.question.id, column: columns[i] })}
                  aria-label={`${row.question.id}, column ${columns[i]}: ${cell.grades.length ? `${fmt(cell.total)} of 6` : "not graded"}`}
                >
                  {cell.grades.length ? (
                    <>
                      <Bars cell={cell} />
                      <span className="total">{fmt(cell.total)}/6</span>
                      {cell.rulesBroken > 0 && <i className="rule-dot" title="A trace rule broke" />}
                      {cell.judgeErrors > 0 && <span className="flag" title="The judge failed on a repeat">!</span>}
                      {cell.unsure > 0 && <span className="flag" title="The judge was unsure">?</span>}
                      {cell.overridden > 0 && <span className="flag mine" title="Your override is used here">✎</span>}
                    </>
                  ) : <span className="muted">not graded</span>}
                </button>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
