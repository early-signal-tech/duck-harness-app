// The EH-1 device: grade a DH-1 setlist. INPUT picks the setlist (FOLLOW DH-1: always the
// newest; PICK: any); SCORES says where each score comes from; JUDGE sets the judge;
// METERS sum it up. GRADE SETLIST grades what isn't graded yet with these settings, and
// the scorecard shows questions (by category) × preset columns. Pick a cell for its
// repeats' verdicts (and your override). RUN mode (RunView) grades one run at a time.

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  describeSource, FACTORY_QUESTION_SETS, hasCheck, parseQuestionSet, questionSetToFile, type QuestionSet,
} from "@dh/formats";
import { type FollowEvent, type Grade, type Grading, type Override, type SetlistInfo } from "./engine";
import { IDLE, onFollowEvent, type ChainControl, type FollowStatus } from "./chain";
import { GradeVerdict } from "./Verdict";
import { nameToStore, cleanText, MAX_NOTE, setlistTitle, suggestedTitle } from "./picker";
import { RenameForm, SetlistPicker } from "./SetlistPicker";
import { RunView } from "./RunView";
import { EfficientFlyout, RubricFlyout } from "./Flyouts";
import { HelpView } from "./HelpView";
import { csvFileName, gradesCsv, gradesSql } from "./exportGrades";
import { Menu, MenuItem } from "@dh/ui-kit";
import { save } from "@tauri-apps/plugin-dialog";
import {
  avg, carefulOf, columnsOf, columnSummary, correctOf, findSet, JUDGE_EFFORTS, JUDGE_MODELS, loadGrader, saveGrader, scorecard,
  TOLERANCES, type Cell,
} from "./scorecard";
import type { EngineConnection } from "./useEngine";
import "./eh1.css";

type InputMode = "follow" | "pick";
type View = "setlist" | "run";

async function loadSets(): Promise<QuestionSet[]> {
  const mine: QuestionSet[] = [];
  try {
    for (const text of await invoke<string[]>("question_set_list")) {
      try {
        mine.push(parseQuestionSet(text));
      } catch (e) {
        console.warn("Skipping a question set file:", e);
      }
    }
  } catch {
    // No native side (a browser preview): built-in sets only.
  }
  return [...FACTORY_QUESTION_SETS, ...mine];
}


const fmt = (n: number | null, digits = 1) => (n === null ? "–" : n.toFixed(digits));
const money = (n: number | null) => (n === null ? "–" : n >= 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(4)}`);

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

export function Eh1({ engine, toolbar, chain }: {
  engine: EngineConnection;
  toolbar?: HTMLElement | null;
  /** Set when EH-1 sits in a chain (the rack), after DH-1. */
  chain?: ChainControl;
}) {
  const { engine: client, status } = engine;
  const ready = status === "ready" && client !== null;

  const [grader, setGrader] = useState(loadGrader);
  useEffect(() => saveGrader(grader), [grader]);
  const [mode, setMode] = useState<InputMode>(() => {
    try {
      return localStorage.getItem("eh1.input") === "pick" ? "pick" : "follow";
    } catch {
      return "follow";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("eh1.input", mode);
    } catch {
      // ignore
    }
  }, [mode]);

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
  const closeHelp = useCallback(() => setHelp(false), []);

  const [sets, setSets] = useState<QuestionSet[]>(FACTORY_QUESTION_SETS);
  const reloadSets = useCallback(async () => setSets(await loadSets()), []);
  useEffect(() => {
    void reloadSets();
  }, [reloadSets]);
  const [setlists, setSetlists] = useState<SetlistInfo[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Each setlist with how much of it is graded with these settings (and the set revisions
  // this face would grade with).
  const setRefs = useMemo(() => sets.map((s) => ({ id: s.id, revision: s.revision })), [sets]);
  const refreshSetlists = useCallback(async () => {
    if (!client || status !== "ready") return;
    try {
      setSetlists(await client.setlists(grader, setRefs));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }, [client, status, grader, setRefs]);
  useEffect(() => {
    void refreshSetlists();
  }, [refreshSetlists]);
  // FOLLOW DH-1: look for a newer setlist every 15 s.
  useEffect(() => {
    if (mode !== "follow" || !ready) return;
    const timer = setInterval(() => void refreshSetlists(), 15_000);
    return () => clearInterval(timer);
  }, [mode, ready, refreshSetlists]);

  const setlist = mode === "follow" ? setlists[0] ?? null : setlists.find((s) => s.id === pickedId) ?? setlists[0] ?? null;
  const { set, revisionMismatch } = findSet(sets, setlist);
  const setOf = useCallback((s: SetlistInfo) => findSet(sets, s).set, [sets]);
  useEffect(() => setRenaming(false), [setlist?.id]);

  const rename = async (name: string, note: string) => {
    if (!client || !setlist) return;
    setProblem(null);
    try {
      await client.rename(setlist.id, nameToStore(name, setlist, set?.name), cleanText(note, MAX_NOTE) || null);
      setRenaming(false);
      await refreshSetlists();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  // A new setlist arriving while following: say so.
  const autoGrade = !!chain?.autoGrade;
  const lastFollowed = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "follow" || !setlist) return;
    if (lastFollowed.current && lastFollowed.current !== setlist.id) {
      setNotice(autoGrade
        ? `New setlist from DH-1: “${setlistTitle(setlist, set?.name)}”. AUTO-GRADE is grading it as it plays.`
        : `New setlist from DH-1: “${setlistTitle(setlist, set?.name)}”. Press GRADE SETLIST to grade it.`);
    }
    lastFollowed.current = setlist.id;
  }, [mode, setlist, set, autoGrade]);

  // The grades for this setlist under these settings.
  const [grades, setGrades] = useState<Grade[]>([]);
  const [graderKey, setGraderKey] = useState<string | null>(null);
  const setFile = useMemo(() => (set ? JSON.parse(questionSetToFile(set)) : null), [set]);
  const loadGrades = useCallback(async () => {
    if (!client || status !== "ready" || !setlist || !setFile) {
      setGrades([]);
      return;
    }
    try {
      const reply = await client.grades(setlist.id, setFile, grader);
      setGrades(reply.grades);
      setGraderKey(reply.graderKey);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }, [client, status, setlist, setFile, grader]);
  useEffect(() => {
    void loadGrades();
  }, [loadGrades]);

  // AUTO-GRADE (in a chain): the engine grades setlist runs as DH-1 finishes them, with
  // this face's judge settings and every set it has. A settings change starts a new follow,
  // which replaces the old one. Grades landing refresh the scorecard (at most once a second).
  const refreshRef = useRef({ loadGrades, refreshSetlists });
  refreshRef.current = { loadGrades, refreshSetlists };
  const onFollowRef = useRef(chain?.onFollow);
  onFollowRef.current = chain?.onFollow;
  const followStatus = useRef<FollowStatus>(IDLE);
  const report = useCallback((next: FollowStatus) => {
    followStatus.current = next;
    onFollowRef.current?.(next);
  }, []);
  const setFiles = useMemo(() => sets.map((s) => JSON.parse(questionSetToFile(s))), [sets]);
  useEffect(() => {
    if (!autoGrade || !ready || !client) {
      if (followStatus.current.active) report({ ...followStatus.current, active: false });
      return;
    }
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        void refreshRef.current.loadGrades();
        void refreshRef.current.refreshSetlists();
      }, 1000);
    };
    const following = client.follow(grader, setFiles, (event: FollowEvent) => {
      report(onFollowEvent(followStatus.current, event));
      if (event.event === "graded") refreshSoon();
    });
    following.done.catch((e) => report({ ...followStatus.current, active: false, problem: e instanceof Error ? e.message : String(e) }));
    return () => {
      if (pending) clearTimeout(pending);
      void following.stop().catch(() => {});
      report({ ...followStatus.current, active: false });
    };
  }, [autoGrade, ready, client, grader, setFiles, report]);

  // Grading.
  const [grading, setGrading] = useState<Grading | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [regrade, setRegrade] = useState(false);
  const grade = () => {
    if (!client || !setlist || !setFile || grading) return;
    setProblem(null);
    setNotice(null);
    let done = 0;
    const g = client.grade(setlist.id, setFile, grader, { regrade, concurrency: 4 }, (event) => {
      if (event.event === "grade_start") setProgress({ done: 0, total: event.to_grade });
      if (event.event === "graded" || event.event === "grade_error") {
        done += 1;
        setProgress((p) => (p ? { ...p, done } : p));
        if (done % 4 === 0) void loadGrades();
      }
    });
    setGrading(g);
    g.done
      .then((summary) => {
        setNotice(
          `${summary.cancelled ? "Stopped" : "Done"}: graded ${summary.graded}` +
          (summary.skipped ? `, ${summary.skipped} already graded` : "") +
          (summary.unmatched ? `, ${summary.unmatched} not in the set` : "") +
          ` · judge ${money(summary.judge_cost_usd)}` +
          (summary.errors.length ? ` · ${summary.errors.length} errors` : ""),
        );
      })
      .catch((e) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setGrading(null);
        setProgress(null);
        setRegrade(false);
        void loadGrades();
        void refreshSetlists();
      });
  };
  const stop = () => void grading?.stop().catch(() => {});

  // Scorecard.
  const columns = columnsOf(setlist, grades);
  const groups = useMemo(() => (set ? scorecard(set, grades, columns) : []), [set, grades, columns]);
  const [picked, setPicked] = useState<{ question: string; column: string } | null>(null);
  const pickedRow = picked ? groups.flatMap((g) => g.rows).find((r) => r.question.id === picked.question) : undefined;
  const pickedCell = pickedRow && picked ? pickedRow.cells[columns.indexOf(picked.column)] : undefined;

  const saveOverride = async (runId: string, value: Omit<Override, "at"> | null) => {
    if (!client || !setFile) return;
    setProblem(null);
    try {
      await client.override(runId, { questionSet: setFile, grader }, value);
      await loadGrades();
      void refreshSetlists();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const regradeCell = (runIds: string[]) => {
    if (!client || !setlist || !setFile || grading) return;
    setProblem(null);
    setNotice(null);
    const g = client.grade(setlist.id, setFile, grader, { regrade: true, runIds, concurrency: 4 });
    setGrading(g);
    setProgress({ done: 0, total: runIds.length });
    g.done
      .then((summary) => setNotice(`Regraded ${summary.graded} run${summary.graded === 1 ? "" : "s"} · judge ${money(summary.judge_cost_usd)}`))
      .catch((e) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setGrading(null);
        setProgress(null);
        void loadGrades();
        void refreshSetlists();
      });
  };

  // Getting grades out.
  const [exportMenu, setExportMenu] = useState(false);
  const exportCsv = async () => {
    if (!setlist || !set) return;
    setProblem(null);
    try {
      const path = await save({ defaultPath: csvFileName(setlist), filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      await invoke("file_write", { path, contents: gradesCsv(setlist, set, grades) });
      setNotice(`Saved ${grades.length} grades to ${path}`);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  const openShell = async () => {
    if (!setlist || !graderKey) return;
    setProblem(null);
    const sql = gradesSql(setlist.id, graderKey);
    let copied = false;
    try {
      await navigator.clipboard.writeText(sql);
      copied = true;
    } catch {
      // No clipboard: the notice says where the query is.
    }
    try {
      await invoke("traces_shell_open");
      setNotice(copied
        ? "Opened the DuckDB shell on the traces. The query for this scorecard is on your clipboard: paste it there."
        : `Opened the DuckDB shell on the traces. Query: ${sql.split("\n").slice(1).join(" ")}`);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

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
            <button role="radio" aria-checked={mode === "follow"} className={mode === "follow" ? "on" : ""} onClick={() => setMode("follow")}>{chain ? "FOLLOW CHAIN" : "FOLLOW DH-1"}</button>
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
            <span className="h2-tools"><RubricFlyout scale={engine.hello?.scale} grader={grader} disabled={!!grading} onApply={setGrader} /></span>
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
