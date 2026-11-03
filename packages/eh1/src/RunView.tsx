// RUN mode: grade one run. RUNS lists runs from the traces (filter, search); the middle
// shows the run's question and answer, matched to a question in a set when it can be
// (by its setlist labels, or the same prompt) or graded against a quick check you write;
// the right side is the verdict, with your override, and the judge settings.

import { Markdown, Menu, MenuDivider, MenuItem, MenuSection } from "@dh/ui-kit";
import { describeSource, questionSetToFile, type QuestionSet } from "@dh/formats";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Engine, GraderSettings, Override, RunDetail, RunGrade, RunKind, RunSummary } from "./engine";
import {
  addQuickCheckQuestion, cleanQuickCheck, currentGrade, gradeTag, matchQuestion, newQuickSet, QUICK_SET_ID, RUN_KINDS,
  runTag, runWhen, sameData, sameQuickCheck, totalOf, type Match,
} from "./runs";
import { JUDGE_EFFORTS, JUDGE_MODELS } from "./scorecard";
import { GradeVerdict } from "./Verdict";

const money = (n: number | null) => (n === null ? "–" : `$${n.toFixed(n >= 0.1 ? 3 : 4)}`);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Target = Match | "quick";

export function RunView({ engine, ready, sets, onSetsChanged, grader, setGrader }: {
  engine: Engine | null;
  ready: boolean;
  sets: QuestionSet[];
  /** Reload the question sets (after saving a question to one). */
  onSetsChanged: () => Promise<void>;
  grader: GraderSettings;
  setGrader: (g: GraderSettings) => void;
}) {
  const [kind, setKind] = useState<RunKind>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    if (!engine || !ready) return;
    try {
      setRuns(await engine.runs(kind, query));
    } catch (e) {
      setProblem(errorText(e));
    }
  }, [engine, ready, kind, query]);
  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ run: RunDetail; grades: RunGrade[] } | null>(null);
  const loadRun = useCallback(async (id: string) => {
    if (!engine) return;
    try {
      setDetail(await engine.run(id));
    } catch (e) {
      setProblem(errorText(e));
    }
  }, [engine]);
  useEffect(() => {
    if (selected) void loadRun(selected);
    else setDetail(null);
  }, [selected, loadRun]);
  // Pick the newest run once the list is in.
  useEffect(() => {
    if (!selected && runs.length) setSelected(runs[0].run_id);
  }, [runs, selected]);

  const run = detail?.run.run_id === selected ? detail.run : null;
  const grades = run ? detail!.grades : [];
  const matched = useMemo(() => (run ? matchQuestion(run, sets) : null), [run, sets]);
  const [picked, setPicked] = useState<Target | null>(null);
  useEffect(() => setPicked(null), [selected]);
  const target: Target | null = run ? picked ?? matched ?? "quick" : null;

  // The quick check form starts from the run's newest quick check.
  const [form, setForm] = useState({ correct: "", careful: "", sql: "" });
  const lastQuick = useMemo(() => currentGrade(grades, "quick"), [grades]);
  useEffect(() => {
    const qc = lastQuick?.quick_check;
    setForm(qc ? { correct: qc.correct ?? "", careful: qc.careful ?? "", sql: (qc.sql ?? []).join("\n") } : { correct: "", careful: "", sql: "" });
    // Only when another run is shown, not when a grade comes back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.run_id]);
  const check = cleanQuickCheck(form);

  const shown = target ? currentGrade(grades, target === "quick" ? "quick" : target) : null;
  const [grading, setGrading] = useState(false);
  const gradeRun = async () => {
    if (!engine || !run || !target) return;
    setProblem(null);
    setGrading(true);
    try {
      if (target === "quick") await engine.gradeRun(run.run_id, grader, { quickCheck: check });
      else await engine.gradeRun(run.run_id, grader, { questionSet: JSON.parse(questionSetToFile(target.set)), question: target.question.id });
      await loadRun(run.run_id);
      void loadRuns();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setGrading(false);
    }
  };
  const saveOverride = async (g: RunGrade, value: Omit<Override, "at"> | null) => {
    if (!engine || !run) return;
    setProblem(null);
    try {
      await engine.override(run.run_id, { graderKey: g.grader_key }, value);
      await loadRun(run.run_id);
      void loadRuns();
    } catch (e) {
      setProblem(errorText(e));
    }
  };

  const [menu, setMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const mine = sets.filter((s) => !s.factory);

  const differentData = run && target && target !== "quick" ? sameData(run, target.set, target.question) === false : false;
  const stale = shown && target === "quick" && !sameQuickCheck(shown, check);
  const canGrade = ready && !!run && !!target && !grading && (target !== "quick" || !!check.correct);

  return (
    <div className="eh1-run">
      <section className="panel run-list">
        <h2>RUNS</h2>
        <div className="segmented" role="radiogroup" aria-label="Which runs">
          {RUN_KINDS.map(([k, label]) => (
            <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{label}</button>
          ))}
        </div>
        <label className="visually-hidden" htmlFor="eh1-run-search">Search runs</label>
        <input id="eh1-run-search" type="search" className="run-search" value={search} placeholder="Search prompts, presets, run IDs…"
          onChange={(e) => setSearch(e.currentTarget.value)} />
        <div className="run-items">
          {runs.length === 0 && <p className="muted small">{ready ? "No runs match." : "Waiting for the grader…"}</p>}
          {runs.map((r) => (
            <button key={r.run_id} className={`run-item${r.run_id === selected ? " on" : ""}`} aria-current={r.run_id === selected}
              onClick={() => setSelected(r.run_id)}>
              <span className="run-item-head"><span>{runWhen(r.started_at)} · {runTag(r)}</span><b>{gradeTag(r)}</b></span>
              <span className="run-item-prompt">{r.prompt}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel run-main">
        {!run ? <p className="muted">{selected ? "Loading the run…" : "Pick a run."}</p> : (
          <>
            <div className="run-main-head">
              <h2>ANSWER · {run.labels.setlist_run ? "SETLIST RUN" : run.labels.pair ? `A/B RUN ${run.labels.ab ?? ""}` : "ONE-OFF RUN"}</h2>
              <span className="run-facts selectable" title={run.run_id}>
                {run.preset?.name ?? "No preset"} · {run.model?.replace(/^claude-/, "")}{run.effort ? ` · ${run.effort}` : ""} · {run.iterations} iterations · {money(run.cost_usd)} · {run.status.replace(/_/g, " ")}
              </span>
            </div>
            <p className="run-prompt">“{run.prompt}”</p>

            <div className={`match${target === "quick" ? " none" : ""}`}>
              <span className="caps">{target === "quick" ? (matched ? "QUICK CHECK" : "NO MATCH") : target!.how === "setlist" ? "SETLIST QUESTION" : target!.how === "prompt" ? "SAME PROMPT" : "PICKED"}</span>
              <span className="match-text">
                {target === "quick"
                  ? matched ? "Graded against your quick check, not the question." : `No question set has this prompt${run.source ? ` (data: ${describeSource(run.source)})` : ""}. Write a quick check, or pick a question.`
                  : <>{target!.set.name} · {target!.question.id} · {target!.question.title}{differentData && <span className="bad"> · this run used other data than the question</span>}</>}
              </span>
              <Menu open={menu} onClose={() => setMenu(false)} label="Grade against" align="right"
                anchor={<button className="pane-button" aria-haspopup="menu" onClick={() => setMenu(!menu)}>{target === "quick" ? "Pick a question…" : "Change…"}</button>}>
                {matched && <MenuItem checked={picked === null || picked === matched} onSelect={() => { setPicked(null); setMenu(false); }}>The matched question ({matched.question.id})</MenuItem>}
                <MenuItem checked={target === "quick"} onSelect={() => { setPicked("quick"); setMenu(false); }}>A quick check</MenuItem>
                <MenuDivider />
                {sets.map((s) => (
                  <MenuSection key={`${s.id}-${s.revision}`} title={`${s.name.toUpperCase()} · R${s.revision}`}>
                    {s.questions.map((q) => (
                      <MenuItem key={q.id} checked={target !== "quick" && target?.set === s && target.question.id === q.id}
                        onSelect={() => { setPicked({ set: s, question: q, how: "picked" }); setMenu(false); }}>
                        {q.id} · {q.title}
                      </MenuItem>
                    ))}
                  </MenuSection>
                ))}
              </Menu>
            </div>

            <div className="run-columns">
              <div className="run-answer">
                <span className="caps muted">AGENT'S ANSWER</span>
                <div className="answer-box">{run.answer ? <Markdown text={run.answer} /> : <p className="muted">No answer ({run.status.replace(/_/g, " ")}).</p>}</div>
              </div>
              <div className="run-check">
                {target === "quick" ? (
                  <>
                    <span className="caps muted">QUICK CHECK</span>
                    <label className="caps" htmlFor="qc-correct">CORRECT IS</label>
                    <textarea id="qc-correct" rows={3} value={form.correct} placeholder="What a right answer says, e.g. the top 5 customers by 1997 order total, with their totals"
                      onChange={(e) => setForm({ ...form, correct: e.currentTarget.value })} />
                    <label className="caps" htmlFor="qc-sql">REFERENCE SQL <span className="muted">optional · runs on the run's data</span></label>
                    <textarea id="qc-sql" rows={4} className="mono" value={form.sql} placeholder="SELECT …"
                      onChange={(e) => setForm({ ...form, sql: e.currentTarget.value })} />
                    {form.sql.trim() && !run.source && <p className="warn small">This run didn't record its data, so the SQL can't run. The judge will grade against CORRECT IS alone.</p>}
                    {form.sql.trim() && run.source && !run.source_recorded && <p className="muted small">Data: {describeSource(run.source)} (from the database the run reported).</p>}
                    <label className="caps" htmlFor="qc-careful">CAREFUL MEANS <span className="muted">optional</span></label>
                    <textarea id="qc-careful" rows={2} value={form.careful} placeholder="The assumptions or caveats it should state"
                      onChange={(e) => setForm({ ...form, careful: e.currentTarget.value })} />
                    {saving ? (
                      <SaveQuestion run={run} check={check} mine={mine} onCancel={() => setSaving(false)}
                        onSaved={async (set, question) => {
                          await onSetsChanged();
                          setSaving(false);
                          setPicked({ set, question, how: "picked" });
                        }} />
                    ) : (
                      <div className="save-row">
                        <button className="pane-button" disabled={!check.correct} onClick={() => setSaving(true)}>Save as a question…</button>
                        <span className="muted small">Adds it to a question set, so it's a permanent test.</span>
                      </div>
                    )}
                  </>
                ) : (
                  <QuestionCheckView match={target!} />
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <aside className="run-side">
        <section className="panel run-verdict">
          <h2>VERDICT {shown && <span className="total-badge">{totalOf(shown) === null ? "–" : totalOf(shown)} / 6</span>}</h2>
          <div className="eh1-verdict verdict-body">
          {!run ? null : !shown ? (
            <p className="muted">{target === "quick" ? "Not graded against a quick check yet." : "Not graded against this question yet."}</p>
          ) : (
            <>
              <p className="muted small">
                {shown.grader ? `${shown.grader.judge_model.replace(/^claude-/, "")} · ${shown.grader.judge_effort} · ${shown.grader.tolerance}` : shown.judge_model ?? ""}
                {" · "}{runWhen(shown.graded_at)} · judge {money(shown.judge_cost_usd)}
                {target !== "quick" && shown.question_set_revision !== null && target && shown.question_set_revision !== target.set.revision && ` · set r${shown.question_set_revision}`}
              </p>
              {stale && <p className="warn small">The quick check changed since this grade. Grade again to use it.</p>}
              <GradeVerdict key={shown.grader_key} grade={shown} heading={shown.question_set === "quick" ? "QUICK CHECK" : `${shown.question_set} · ${shown.question}`}
                busy={grading} showReference onOverride={(value) => saveOverride(shown, value)} />
            </>
          )}
          </div>
          {problem && <p className="error small">{problem}</p>}
          <div className="verdict-actions">
            <button className="run" disabled={!canGrade} onClick={() => void gradeRun()}
              title={target === "quick" && !check.correct ? "Write what a correct answer says first" : undefined}>
              {grading ? "GRADING…" : shown ? "▶ GRADE AGAIN" : "▶ GRADE RUN"}
            </button>
          </div>
        </section>
        <section className="panel run-judge">
          <h2>JUDGE</h2>
          <div className="segmented" role="radiogroup" aria-label="Judge model">
            {JUDGE_MODELS.map((m) => (
              <button key={m.id} role="radio" aria-checked={grader.judge_model === m.id} className={grader.judge_model === m.id ? "on" : ""}
                disabled={grading} onClick={() => setGrader({ ...grader, judge_model: m.id })}>{m.label}</button>
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label="Judge effort">
            {JUDGE_EFFORTS.map((e) => (
              <button key={e} role="radio" aria-checked={grader.judge_effort === e} className={grader.judge_effort === e ? "on" : ""}
                disabled={grading} onClick={() => setGrader({ ...grader, judge_effort: e })}>{e.toUpperCase()}</button>
            ))}
          </div>
          <span className="muted small">Tolerance {grader.tolerance} · budget {grader.iteration_budget} (set in SETLIST mode)</span>
        </section>
      </aside>
    </div>
  );
}

/** What the matched question checks: its criteria and reference SQL, read-only. */
function QuestionCheckView({ match }: { match: Match }) {
  const c = match.question.check;
  const source = match.question.source ?? match.set.source;
  return (
    <>
      <span className="caps muted">QUESTION'S CHECK</span>
      {!c ? <p className="muted">This question has no check: only EFFICIENT and trace rules are graded.</p> : (
        <dl className="q-check">
          {c.correct && <><dt>CORRECT IS</dt><dd>{c.correct}</dd></>}
          {c.reference && <><dt>REFERENCE</dt><dd>{c.reference}</dd></>}
          {c.careful && <><dt>CAREFUL MEANS</dt><dd>{c.careful}</dd></>}
          {c.fail && <><dt>FAILS IF</dt><dd>{c.fail}</dd></>}
          {c.sql?.length ? <><dt>REFERENCE SQL</dt><dd><pre className="selectable">{c.sql.join("\n\n")}</pre></dd></> : null}
          {c.rules?.length ? <><dt>TRACE RULES</dt><dd>{c.rules.length} rule{c.rules.length === 1 ? "" : "s"}</dd></> : null}
          {source && <><dt>DATA</dt><dd>{describeSource(source)}</dd></>}
        </dl>
      )}
    </>
  );
}

/** Pick a MINE set (or a new "Quick checks" set), a title, and a category; adds the run's
 *  prompt with your quick check as a question, as the set's next revision. */
function SaveQuestion({ run, check, mine, onSaved, onCancel }: {
  run: RunDetail;
  check: ReturnType<typeof cleanQuickCheck>;
  mine: QuestionSet[];
  onSaved: (set: QuestionSet, question: QuestionSet["questions"][number]) => Promise<void>;
  onCancel: () => void;
}) {
  const quickSet = mine.find((s) => s.id === QUICK_SET_ID);
  const choices = quickSet ? mine : [...mine, newQuickSet()];
  const [setId, setSetId] = useState(QUICK_SET_ID);
  const [title, setTitle] = useState(run.prompt.replace(/\s+/g, " ").slice(0, 60));
  const [category, setCategory] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = choices.find((s) => s.id === setId) ?? choices[0];
  const noData = !run.source && !target.source;

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { set, question } = addQuickCheckQuestion(target, run, check, { title, category: category || undefined });
      await invoke("question_set_write", { id: set.id, contents: questionSetToFile(set) });
      await onSaved(set, question);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="save-form">
      <label className="caps" htmlFor="save-set">SET</label>
      <select id="save-set" value={target.id} onChange={(e) => { setSetId(e.currentTarget.value); setCategory(""); }}>
        {choices.map((s) => <option key={s.id} value={s.id}>{s.name}{s.questions.length ? ` (${s.questions.length})` : " (new)"}</option>)}
      </select>
      <label className="caps" htmlFor="save-title">TITLE</label>
      <input id="save-title" value={title} maxLength={120} onChange={(e) => setTitle(e.currentTarget.value)} />
      {target.categories.length > 0 && (
        <>
          <label className="caps" htmlFor="save-category">CATEGORY</label>
          <select id="save-category" value={category} onChange={(e) => setCategory(e.currentTarget.value)}>
            <option value="">None</option>
            {target.categories.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.name}</option>)}
          </select>
        </>
      )}
      <p className="muted small">
        {target.revision === 0 && !target.questions.length
          ? `Makes a new set in MINE, ${target.name}.`
          : `Saves ${target.name} as revision ${target.revision + 1}. Grades made with revision ${target.revision} stay, under that revision.`}
      </p>
      {noData && <p className="warn small">This run didn't record its data and {target.name} has none of its own, so the question would have nothing to run on. Pick a set with data.</p>}
      {problem && <p className="error small">{problem}</p>}
      <div className="buttons">
        <button className="pane-button" onClick={onCancel}>Cancel</button>
        <button className="pane-button primary" disabled={busy || !title.trim() || noData} onClick={() => void save()}>Save</button>
      </div>
    </div>
  );
}
