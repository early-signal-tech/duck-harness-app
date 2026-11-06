// EH-1's compact rack card: the strip, a tile per section (JUDGE, RUBRIC, INPUT,
// TOLERANCE, each with its current value), and the essentials (a mini scorecard of the
// shown setlist, the COR / CAR / EFF meters, how much is graded). Any of it opens the full
// editor in the rack's top panel. It's a view of the same model the editor draws (useEh1).

import { useMemo } from "react";
import { DeviceStrip, RackCard, Tile } from "@dh/ui-kit";
import { avg, carefulOf, columnsOf, correctOf, JUDGE_MODELS, scorecard } from "./scorecard";
import type { EngineConnection } from "./useEngine";
import type { Eh1Model } from "./useEh1";

/** A mini scorecard cell's shade from its average total (0–6), or empty when ungraded. */
function shade(total: number | null): string {
  if (total === null) return "empty";
  if (total >= 5.5) return "full";
  if (total >= 4) return "high";
  if (total >= 2) return "mid";
  return "low";
}

export function Eh1Card({ model, status, collapsed, onToggleCollapse, onOpen, chained = false, name = "EH-1", cardProps }: {
  model: Eh1Model;
  status: EngineConnection["status"];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpen: () => void;
  chained?: boolean;
  name?: string;
  /** Selection and the right-click menu, from the rack. */
  cardProps?: { selected: boolean; onSelect: () => void; onContextMenu: (e: React.MouseEvent) => void };
}) {
  const { grader, mode, setlist, set, grades, grading } = model;
  const judge = JUDGE_MODELS.find((m) => m.id === grader.judge_model)?.label ?? grader.judge_model;
  const columns = columnsOf(setlist, grades);
  const cells = useMemo(() => {
    if (!set) return [];
    return scorecard(set, grades, columns).flatMap((g) => g.rows).flatMap((r) => r.cells.map((c) => (c.grades.length ? c.total : null)));
  }, [set, grades, columns]);
  const meters: [string, number | null][] = [
    ["COR", avg(grades.map(correctOf))],
    ["CAR", avg(grades.map(carefulOf))],
    ["EFF", avg(grades.map((g) => g.efficient))],
  ];
  return (
    <RackCard
      className="eh1-card"
      collapsed={collapsed}
      {...cardProps}
      strip={<DeviceStrip name={name} status={status} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onOpen={onOpen} live={!!grading} />}
      tiles={<>
        <Tile label="JUDGE" value={`${judge[0]}${judge.slice(1).toLowerCase()} · ${grader.judge_effort}`} onClick={onOpen} />
        <Tile label="RUBRIC" value={grader.name} onClick={onOpen} />
        <Tile label="INPUT" value={mode === "follow" ? (chained ? "Follow chain" : "Follow DH-1") : "Picked"} onClick={onOpen} />
        <Tile label="TOLERANCE" value={grader.tolerance} onClick={onOpen} />
      </>}
    >
      {/* One square per scorecard cell (question × column), in order: a heat map. */}
      <button className="card-scorecard" onClick={onOpen} aria-label="Open EH-1: the scorecard">
        {cells.length === 0
          ? <span className="muted">{setlist ? "No question set" : "No setlist yet"}</span>
          : cells.slice(0, 48).map((total, i) => <i key={i} className={shade(total)} />)}
      </button>
      <div className="card-meters">
        {meters.map(([label, value]) => (
          <span key={label} className="card-meter-bar" title={`${label} ${value === null ? "–" : value.toFixed(1)}`}>
            <span><i style={{ height: `${value === null ? 0 : (value / 2) * 100}%` }} /></span>
            <span className="tile-label">{label}</span>
          </span>
        ))}
        <span className="card-graded">
          <span className="tile-label">GRADED</span>
          <b>{grades.length}/{setlist?.runs ?? 0}</b>
        </span>
      </div>
    </RackCard>
  );
}
