// The SCORES panel's flyouts: RUBRIC (the scale the judge grades on, and your own notes
// for it) and EFFICIENT (the iteration budget and how much waste still scores 1). Both
// are grader settings: changing them grades anew, beside the old grades.

import { useDismiss } from "@dh/ui-kit";
import { useRef, useState, type ReactNode } from "react";
import type { GraderSettings, ScaleRow } from "./engine";
import { DEFAULT_GRADER } from "./scorecard";

/** The scale as the engine states it, for engines too old to send it. */
export const FALLBACK_SCALE: ScaleRow[] = [
  { score: "CORRECT", "2": "Numbers and claims match the reference (within the tolerance)", "1": "Right approach, minor errors or omissions", "0": "Wrong or invented numbers, or a different question" },
  { score: "CAREFUL", "2": "States its assumptions and flags the data issues that matter", "1": "Some of them", "0": "Overclaims, or misses an obvious issue" },
  { score: "EFFICIENT", "2": "Within the iteration budget, no waste", "1": "A little waste", "0": "A limit, over twice the budget, or a lot of waste" },
];

const MAX_INSTRUCTIONS = 2000;

function Flyout({ label, button, buttonLabel, className = "", children, align = "right" }: {
  label: string;
  button: ReactNode;
  buttonLabel: string;
  className?: string;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismiss(root, open, close);
  return (
    <div className="menu-root" ref={root}>
      <button className={`pane-button flyout-button ${className}`} aria-haspopup="dialog" aria-expanded={open} aria-label={buttonLabel}
        onClick={() => setOpen(!open)}>{button}</button>
      {open && <div className={`menu ${align} eh1-flyout`} role="dialog" aria-label={label}>{children(close)}</div>}
    </div>
  );
}

const CHANGES = "Changing this makes new grades (the judge runs again); the old ones stay in the traces.";

export function RubricFlyout({ scale, grader, disabled, onApply }: {
  scale: ScaleRow[] | undefined;
  grader: GraderSettings;
  disabled: boolean;
  onApply: (g: GraderSettings) => void;
}) {
  const has = !!grader.instructions?.trim();
  return (
    <Flyout label="Rubric" buttonLabel="Rubric" button={<>RUBRIC{has && <i className="dot" aria-label="(with your notes)" />} ⋯</>}>
      {(close) => <RubricBody scale={scale ?? FALLBACK_SCALE} grader={grader} disabled={disabled} close={close} onApply={onApply} />}
    </Flyout>
  );
}

function RubricBody({ scale, grader, disabled, close, onApply }: {
  scale: ScaleRow[];
  grader: GraderSettings;
  disabled: boolean;
  close: () => void;
  onApply: (g: GraderSettings) => void;
}) {
  const [notes, setNotes] = useState(grader.instructions ?? "");
  const has = !!grader.instructions?.trim();
  const changed = notes.trim() !== (grader.instructions ?? "").trim();
  return (
    <div className="flyout-body">
      <span className="caps muted">THE SCALE</span>
      <table className="scale">
        <thead><tr><th /><th>2</th><th>1</th><th>0</th></tr></thead>
        <tbody>
          {scale.map((row) => (
            <tr key={row.score}><th>{row.score}</th><td>{row["2"]}</td><td>{row["1"]}</td><td>{row["0"]}</td></tr>
          ))}
        </tbody>
      </table>
      <span className="muted small">Each question's own CORRECT, CAREFUL, FAILS IF, and BONUS notes go to the judge with this.</span>
      <label className="caps muted" htmlFor="eh1-judge-notes">ALSO TELL THE JUDGE</label>
      <textarea id="eh1-judge-notes" rows={4} value={notes} maxLength={MAX_INSTRUCTIONS} disabled={disabled}
        placeholder="e.g. Rounding to whole percents is fine. A bonus note can lift CAREFUL to 2, never CORRECT."
        onChange={(e) => setNotes(e.currentTarget.value)} />
      <span className="muted small">Sent with every question. {CHANGES}</span>
      <div className="buttons">
        {has && <button className="pane-button" disabled={disabled} onClick={() => { onApply({ ...grader, instructions: "" }); close(); }}>Clear notes</button>}
        <button className="pane-button" onClick={close}>Cancel</button>
        <button className="pane-button primary" disabled={disabled || !changed} onClick={() => { onApply({ ...grader, instructions: notes.trim() }); close(); }}>Apply</button>
      </div>
    </div>
  );
}

function Stepper({ id, value, min, max, onChange, disabled }: {
  id: string; value: number; min: number; max: number; onChange: (n: number) => void; disabled: boolean;
}) {
  return (
    <div className="stepper">
      <button className="pane-button" aria-label="Less" disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>−</button>
      <output id={id} aria-live="polite">{value}</output>
      <button className="pane-button" aria-label="More" disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

export function EfficientFlyout({ grader, disabled, onApply }: {
  grader: GraderSettings;
  disabled: boolean;
  onApply: (g: GraderSettings) => void;
}) {
  return (
    <Flyout label="Efficient" buttonLabel="Efficient thresholds" button="⋯" className="row-flyout">
      {(close) => <EfficientBody grader={grader} disabled={disabled} close={close} onApply={onApply} />}
    </Flyout>
  );
}

function EfficientBody({ grader, disabled, close, onApply }: {
  grader: GraderSettings; disabled: boolean; close: () => void; onApply: (g: GraderSettings) => void;
}) {
  const [budget, setBudget] = useState(grader.iteration_budget);
  const [waste, setWaste] = useState(grader.waste_for_one ?? DEFAULT_GRADER.waste_for_one!);
  const changed = budget !== grader.iteration_budget || waste !== (grader.waste_for_one ?? DEFAULT_GRADER.waste_for_one);
  const isDefault = budget === DEFAULT_GRADER.iteration_budget && waste === DEFAULT_GRADER.waste_for_one;
  return (
    <div className="flyout-body efficient">
      <span className="small">Scored from the traces, no judge. <b>Waste</b> is failed tool calls, repeated identical queries, and truncated results after the first.</span>
      <div className="setting-row">
        <label className="caps" htmlFor="eh1-budget">ITERATION BUDGET</label>
        <Stepper id="eh1-budget" value={budget} min={1} max={50} onChange={setBudget} disabled={disabled} />
      </div>
      <div className="setting-row">
        <label className="caps" htmlFor="eh1-waste">WASTE THAT STILL SCORES 1</label>
        <Stepper id="eh1-waste" value={waste} min={0} max={10} onChange={setWaste} disabled={disabled} />
      </div>
      <ul className="levels">
        <li><b>2</b> no waste, and at most {budget} iterations</li>
        <li><b>1</b> at most {waste} piece{waste === 1 ? "" : "s"} of waste, and at most {budget * 2} iterations</li>
        <li><b>0</b> more waste, over {budget * 2} iterations, or it hit the iteration or token limit</li>
      </ul>
      <span className="muted small">{CHANGES}</span>
      <div className="buttons">
        {!isDefault && <button className="pane-button" disabled={disabled} onClick={() => { setBudget(DEFAULT_GRADER.iteration_budget); setWaste(DEFAULT_GRADER.waste_for_one!); }}>Defaults</button>}
        <button className="pane-button" onClick={close}>Cancel</button>
        <button className="pane-button primary" disabled={disabled || !changed} onClick={() => { onApply({ ...grader, iteration_budget: budget, waste_for_one: waste }); close(); }}>Apply</button>
      </div>
    </div>
  );
}
