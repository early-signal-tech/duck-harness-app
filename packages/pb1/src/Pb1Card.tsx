// PB-1's compact rack card: the strip, four tiles (catalog, mode with tempo and length, table,
// the last run), and a small display with the 16 pads in two rows of 8, so a run can be
// watched without opening the panel. It's read-only like ES-1's card: anything on it opens the full panel, where
// START and the knobs are. It shows what the panel reports (Pb1Summary).

import { DeviceStrip, RackCard, Tile } from "@dh/ui-kit";
import type { Pb1Connection } from "./engine";
import type { Pb1Summary } from "./summary";

export function Pb1Card({ summary, status, collapsed, onToggleCollapse, onOpen, cardProps }: {
  /** Null until the panel has reported. */
  summary: Pb1Summary | null;
  status: Pb1Connection["status"];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpen: () => void;
  /** Selection and the right-click menu, from the rack. */
  cardProps?: { selected: boolean; onSelect: () => void; onContextMenu: (e: React.MouseEvent) => void };
}) {
  return (
    <RackCard
      className="pb1-card"
      collapsed={collapsed}
      {...cardProps}
      strip={<DeviceStrip name="PB-1" status={status} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onOpen={onOpen} live={!!summary?.busy} />}
      tiles={<>
        <Tile label="CATALOG" value={summary?.catalog ?? "–"} onClick={onOpen} />
        <Tile label={summary?.mode.label ?? "MODE"} value={summary?.mode.value ?? "–"} onClick={onOpen} />
        <Tile label="TABLE" value={summary?.table ?? "–"} onClick={onOpen} />
        <Tile label={summary?.stat.label ?? "LAST RUN"} value={summary?.stat.value ?? "–"} onClick={onOpen} />
      </>}
    >
      <button className="pb1-card-face" onClick={onOpen} aria-label="Open PB-1">
        <span className="pb1-card-lcd">
          <small>{summary?.display.title ?? "–"}</small>
          <span>{summary?.display.line ?? ""}</span>
        </span>
        <span className="pb1-card-pads" aria-hidden="true">
          {(summary?.pads ?? []).map((pad, i) => (
            <i key={i} className={`${pad.mark ?? ""}${pad.flush ? " flush" : ""}${i === summary?.lit ? " now" : ""}`} />
          ))}
        </span>
      </button>
      {summary?.busy && <span className="pb1-card-state on">{summary.busy}</span>}
      {summary?.problem && <span className="pb1-card-state problem" title={summary.problem}>{summary.problem}</span>}
    </RackCard>
  );
}
