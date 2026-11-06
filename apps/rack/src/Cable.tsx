// The cable between DH-1 and EH-1: what DH-1 finishes flows into EH-1 (FOLLOW CHAIN), and
// AUTO-GRADE decides whether EH-1 grades it as it lands. Only setlists are auto-graded
// (single runs and A/B compares wait for you in EH-1's RUN mode), and the judge spend this
// session shows here. Off by default each time the rack opens: grading costs money.

import type { FollowStatus } from "@dh/eh1";

interface Props {
  autoGrade: boolean;
  onAutoGrade: (on: boolean) => void;
  status: FollowStatus;
  /** EH-1's engine is up, so following can run. */
  ready: boolean;
}

export function Cable({ autoGrade, onAutoGrade, status, ready }: Props) {
  const live = autoGrade && status.active;
  const state = !autoGrade ? "Grade setlists as they play" : !ready ? "Waiting for EH-1's engine" : live ? "Grading setlists as they play" : "Starting…";
  return (
    <div className="cable" aria-label="Chain: DH-1 into EH-1">
      <div className="cable-wire" aria-hidden="true" />
      <div className="cable-box">
        <span className="cable-signal"><span className={`dot${live ? " on" : ""}`} aria-hidden="true" />CHAIN</span>
        <span className="cable-label" id="auto-grade-label">AUTO-GRADE</span>
        <div className="segmented" role="radiogroup" aria-labelledby="auto-grade-label">
          <button role="radio" aria-checked={!autoGrade} className={!autoGrade ? "on" : ""} onClick={() => onAutoGrade(false)}>OFF</button>
          <button role="radio" aria-checked={autoGrade} className={autoGrade ? "on" : ""} onClick={() => onAutoGrade(true)}>ON</button>
        </div>
        <span className="cable-note">{state}</span>
        {status.graded > 0 && (
          <span className="cable-stats" title="Graded by AUTO-GRADE since the rack opened, and what the judge cost">
            {status.graded} graded<br />judge ${status.judgeCost.toFixed(4)}
          </span>
        )}
        {status.problem && <span className="cable-problem" title={status.problem}>{status.problem}</span>}
      </div>
    </div>
  );
}
