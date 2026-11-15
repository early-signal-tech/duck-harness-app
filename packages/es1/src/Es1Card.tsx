// ES-1's compact rack card: the strip, a tile each for the login and what's live, and the
// essentials (how many tasks are OK, alerting, failing, or off). Any of it opens the full
// panel in the rack. It shows what the panel reports (Es1Summary), so it's only as fresh
// as the panel's last catalog read.

import { DeviceStrip, RackCard, Tile } from "@dh/ui-kit";
import type { Es1Summary } from "./Es1";
import type { EngineConnection } from "./useEngine";

const HEALTH: { key: "ok" | "alert" | "failing" | "disabled"; label: string }[] = [
  { key: "ok", label: "OK" },
  { key: "alert", label: "ALERT" },
  { key: "failing", label: "FAILING" },
  { key: "disabled", label: "OFF" },
];

export function Es1Card({ summary, status, collapsed, onToggleCollapse, onOpen, cardProps }: {
  /** Null until the panel has reported (it reads the catalog once the engine is up). */
  summary: Es1Summary | null;
  status: EngineConnection["status"];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpen: () => void;
  /** Selection and the right-click menu, from the rack. */
  cardProps?: { selected: boolean; onSelect: () => void; onContextMenu: (e: React.MouseEvent) => void };
}) {
  const counts = summary?.counts ?? null;
  const login = summary?.loggedIn === true ? "Logged in" : summary?.loggedIn === false ? "Not logged in" : "–";
  return (
    <RackCard
      className="es1-card"
      collapsed={collapsed}
      {...cardProps}
      strip={<DeviceStrip name="ES-1" status={status} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onOpen={onOpen} live={!!summary?.busy} />}
      tiles={<>
        <Tile label="PROFILE" value={summary?.profile ?? "–"} onClick={onOpen} />
        <Tile label="LOGIN" value={login} onClick={onOpen} />
        <Tile label="TASKS" value={counts?.tasks ?? "–"} onClick={onOpen} />
        <Tile label="COLLECTIONS" value={counts?.collections ?? "–"} onClick={onOpen} />
      </>}
    >
      <button className="es1-card-health" onClick={onOpen} aria-label="Open ES-1: what's live">
        {HEALTH.map(({ key, label }) => (
          <span key={key} className={`es1-card-count ${key}${counts && counts[key] > 0 ? " some" : ""}`}>
            <b>{counts ? counts[key] : "–"}</b>
            <span className="tile-label">{label}</span>
          </span>
        ))}
      </button>
      {summary?.busy && <span className="es1-card-state on">BUILD: {summary.busy}…</span>}
      {summary?.problem && <span className="es1-card-state problem" title={summary.problem}>{summary.problem}</span>}
    </RackCard>
  );
}
