// A graded run as a verdict panel shows it, in SETLIST mode (one per repeat of a cell) and
// RUN mode: CORRECT, CAREFUL, EFFICIENT with the reasons, trace rules, the values the judge
// compared, and your override.

import { useState } from "react";
import { valueCheck, type Grade, type Override, type ReferenceResult } from "./engine";
import { carefulOf, correctOf } from "./scorecard";

/** What the panel needs from a grade (a scorecard Grade or a RUN mode RunGrade). */
export type VerdictGrade = Pick<Grade,
  "run_id" | "correct" | "careful" | "efficient" | "correct_reason" | "careful_reason" | "efficient_reason" |
  "judge_unsure" | "judge_values" | "rules" | "judge_error" | "override"> & { reference?: ReferenceResult[] | null };

const CHECK_TEXT = {
  matches: "Checked: matches the reference",
  differs: "Checked: differs from the reference",
  unverified: "Unverified: the question gives no reference for this value",
} as const;

/** One graded run in a verdict panel: its scores, reasons, rules, values, the reference
 *  results (when shown), and your override. */
export function GradeVerdict({ grade: g, heading, busy, onOverride, showReference = false }: {
  grade: VerdictGrade;
  heading: string;
  showReference?: boolean;
  busy: boolean;
  onOverride: (value: Omit<Override, "at"> | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [correct, setCorrect] = useState(g.override?.correct ?? g.correct ?? 1);
  const [careful, setCareful] = useState(g.override?.careful ?? g.careful ?? 1);
  const [why, setWhy] = useState(g.override?.why ?? "");
  const [saving, setSaving] = useState(false);
  const save = async (value: Omit<Override, "at"> | null) => {
    setSaving(true);
    await onOverride(value);
    setSaving(false);
    setEditing(false);
  };
  const pick = (label: string, value: number, set: (n: number) => void) => (
    <div className="override-row">
      <span className="caps">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {[0, 1, 2].map((n) => (
          <button key={n} role="radio" aria-checked={value === n} className={value === n ? "on" : ""} onClick={() => set(n)}>{n}</button>
        ))}
      </div>
    </div>
  );
  return (
              <div className="repeat">
                <div className="repeat-head">
                  <span>{heading}</span>
                  <b>{correctOf(g) ?? "–"} · {carefulOf(g) ?? "–"} · {g.efficient ?? "–"}</b>
                </div>
                {g.judge_error && <p className="error">{g.judge_error}</p>}
                {g.judge_unsure && <p className="unsure">The judge was unsure.</p>}
                <dl>
                  <dt>CORRECT</dt><dd>{g.correct_reason ?? "–"}</dd>
                  <dt>CAREFUL</dt><dd>{g.careful_reason ?? "–"}</dd>
                  <dt>EFFICIENT</dt><dd>{g.efficient_reason ?? "–"}</dd>
                </dl>
                {g.rules && g.rules.length > 0 && (
                  <ul className="rules">
                    {g.rules.map((r, i) => <li key={i} className={r.passed ? "" : "bad"}>{r.passed ? "✓" : "✕"} {r.label} <span>· {r.detail}</span></li>)}
                  </ul>
                )}
                {g.judge_values && g.judge_values.length > 0 && (
                  <>
                    <table className="values">
                      <thead><tr><th>VALUE</th><th>AGENT</th><th>REF</th><th /></tr></thead>
                      <tbody>
                        {g.judge_values.map((v, i) => {
                          const check = valueCheck(v);
                          return (
                            <tr key={i} className={check}>
                              <td>{v.name}</td><td>{v.agent}</td><td>{check === "unverified" ? "–" : v.reference}</td>
                              <td title={CHECK_TEXT[check]}>{check === "matches" ? "✓" : check === "differs" ? "✕" : "–"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {g.judge_values.some((v) => valueCheck(v) === "unverified") && (
                      <p className="unverified-note">– unverified: the question gives no reference for this value. Add one to the question set to check it.</p>
                    )}
                  </>
                )}
                {g.override && !editing && (
                  <p className="override-note">
                    ✎ Your call: Correct {g.override.correct}, Careful {g.override.careful} (judge said {g.correct ?? "–"}, {g.careful ?? "–"})
                    {g.override.why && <> · “{g.override.why}”</>}
                  </p>
                )}
                {editing ? (
                  <div className="override-form">
                    {pick("CORRECT", correct, setCorrect)}
                    {pick("CAREFUL", careful, setCareful)}
                    <label className="caps muted" htmlFor={`why-${g.run_id}`}>WHY</label>
                    <input id={`why-${g.run_id}`} value={why} maxLength={500} placeholder="A short reason" onChange={(e) => setWhy(e.currentTarget.value)} />
                    <div className="override-buttons">
                      <button className="pane-button" onClick={() => setEditing(false)}>Cancel</button>
                      <button className="pane-button primary" disabled={saving} onClick={() => void save({ correct, careful, why })}>Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="override-buttons">
                    <button className="pane-button" disabled={busy || g.correct === null && !g.judge_error && !g.override} onClick={() => setEditing(true)}>
                      {g.override ? "Change override…" : "Override…"}
                    </button>
                    {g.override && <button className="pane-button" disabled={busy || saving} onClick={() => void save(null)}>Clear override</button>}
                  </div>
                )}
                {showReference && g.reference && g.reference.length > 0 && (
                  <div className="reference">
                    <span className="caps muted">REFERENCE SQL</span>
                    {g.reference.map((r, i) => (
                      <details key={i}>
                        <summary className={r.error ? "bad" : undefined}>{r.error ? `✕ ${r.error}` : `${r.rows} row${r.rows === 1 ? "" : "s"}`}</summary>
                        <pre className="selectable">{r.sql}{r.preview ? `\n\n${r.preview}` : ""}</pre>
                      </details>
                    ))}
                  </div>
                )}
                <p className="run-id selectable">{g.run_id}</p>
              </div>
  );
}
