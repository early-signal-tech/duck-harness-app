// AUTO GRADER: a utility that wraps its own EH-1. It sits after DH-1 and listens: with its
// power on, the EH-1 inside grades each setlist run as it finishes (eh1-grader's follow),
// with that EH-1's own judge settings, and the card shows the latest grade and what it has
// graded and spent since the rack opened. The EH-1 inside opens in the panel like any
// device (the inner slot, or ⤢).

import type { Eh1Model, FollowStatus } from "@dh/eh1";
import { DeviceStrip, RackCard } from "@dh/ui-kit";

const score = (v: number | null) => (v === null ? "–" : String(v));

export function AutoGraderCard({ on, onToggle, status, inner, problem, collapsed, onToggleCollapse, onOpen, cardProps }: {
  on: boolean;
  onToggle: () => void;
  status: FollowStatus;
  /** The EH-1 inside. */
  inner: Eh1Model;
  /** Why it can't work where it is (no DH-1 before it), or null. */
  problem: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Open the EH-1 inside in the panel. */
  onOpen: () => void;
  cardProps: { selected: boolean; onSelect: () => void; onContextMenu: (e: React.MouseEvent) => void };
}) {
  const judge = inner.grader.judge_model.replace(/^claude-/, "").split("-")[0];
  const live = on && !problem && status.active;
  const state = problem ?? (!on ? "Off: setlists aren't graded" : !inner.ready ? "Waiting for the grader" : status.active ? "Grading each setlist run as it finishes" : "Starting…");
  const last = status.last;
  return (
    <RackCard
      className="autograder-card"
      collapsed={collapsed}
      {...cardProps}
      strip={<DeviceStrip name="AUTO GRADER" kind="utility" power={{ on, onToggle }} collapsed={collapsed}
        onToggleCollapse={onToggleCollapse} onOpen={onOpen} live={live} />}
    >
      <span className="tile-label">LATEST</span>
      {last ? (
        <span className="autograder-last" title={`${last.question}: correct ${score(last.correct)}, careful ${score(last.careful)}, efficient ${last.efficient}`}>
          <b>{score(last.correct)} · {score(last.careful)} · {last.efficient}</b>
          <span>{last.question}{last.rulesPassed === false ? " · rule ✕" : ""}</span>
        </span>
      ) : (
        <span className="autograder-state">No grades yet</span>
      )}
      <span className={`autograder-state${live ? " on" : ""}${problem ? " problem" : ""}`}>{state}</span>
      {status.problem && !problem && <span className="autograder-problem" title={status.problem}>{status.problem}</span>}
      <div className="card-meter">
        <span className="tile-label">THIS SESSION</span>
        <span className="autograder-count">{status.graded} graded · ${status.judgeCost.toFixed(4)}</span>
        {/* The EH-1 inside, collapsed: open it to change its judge, rubric, tolerance. */}
        <button className="autograder-inner" onClick={onOpen} title="Open the EH-1 inside AUTO GRADER">
          <span className="inner-name">EH-1</span>
          <span className="inner-what">
            <span>{judge.charAt(0).toUpperCase() + judge.slice(1)} · {inner.grader.judge_effort}</span>
            <span className="muted">{inner.grader.name}</span>
          </span>
          <span aria-hidden="true">⤢</span>
        </button>
      </div>
    </RackCard>
  );
}
