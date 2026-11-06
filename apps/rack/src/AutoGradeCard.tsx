// AUTO-GRADE: a utility in the chain, after DH-1. Its power button is the switch: on, EH-1's
// engine grades each setlist run as it finishes (eh1-grader's follow), with EH-1's judge.
// The card shows what it's doing and what it has graded and spent since the rack opened.
// (Next: AUTO GRADER, with its own EH-1 inside.)

import type { FollowStatus } from "@dh/eh1";
import { DeviceStrip, RackCard } from "@dh/ui-kit";

export function AutoGradeCard({ on, onToggle, status, ready, judge, collapsed, onToggleCollapse }: {
  on: boolean;
  onToggle: () => void;
  status: FollowStatus;
  /** EH-1's engine is up, so following can run. */
  ready: boolean;
  /** EH-1's judge, as a short label ("Haiku · low"). */
  judge: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const state = !on ? "Off: setlists wait for GRADE in EH-1" : !ready ? "Waiting for EH-1's engine" : status.active ? "Grading each setlist run as it finishes" : "Starting…";
  return (
    <RackCard
      className="autograde-card"
      collapsed={collapsed}
      strip={<DeviceStrip name="AUTO-GRADE" kind="utility" power={{ on, onToggle }} collapsed={collapsed}
        onToggleCollapse={onToggleCollapse} live={on && status.active} />}
    >
      <span className="tile-label">GRADES</span>
      <span className="autograde-what">Setlists</span>
      <span className="tile-label">STATUS</span>
      <span className={`autograde-state${on && status.active ? " on" : ""}`}>{state}</span>
      {status.problem && <span className="autograde-problem" title={status.problem}>{status.problem}</span>}
      <div className="card-meter">
        <span className="tile-label">THIS SESSION</span>
        <b className="autograde-count">{status.graded} graded</b>
        <span className="card-cost">${status.judgeCost.toFixed(4)}</span>
        <span className="autograde-judge">Judge: EH-1's ({judge})</span>
      </div>
    </RackCard>
  );
}
