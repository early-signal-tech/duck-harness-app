// The pieces of a compact rack card, shared by every device: the vertical name strip on
// its left (like Bitwig's), and the section tiles beside it.
//
// The strip shows the device's name running up it and its engine light, with ⤢ to open
// the device in the rack's top panel. A utility (AUTO-GRADE) gets a power button there,
// which is its on/off. Double-click the strip to collapse the card to just the strip, and
// again to expand it; a collapsed device keeps working.

import type { ReactNode } from "react";
import type { EngineStatus } from "./HostBar";

interface StripProps {
  name: string;
  /** The device's engine light; left out for a device without an engine of its own. */
  status?: EngineStatus;
  /** A utility's on/off. */
  power?: { on: boolean; onToggle: () => void };
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Open the device in the top panel; left out for a device with nothing more to show. */
  onOpen?: () => void;
  /** It's working in the background (a following AUTO-GRADE, a running setlist). */
  live?: boolean;
  /** "utility" draws a lighter strip, like Bitwig's Tool. */
  kind?: "instrument" | "utility";
}

const STATUS = { ready: "running", connecting: "starting", down: "offline" } as const;

export function DeviceStrip({ name, status, power, collapsed, onToggleCollapse, onOpen, live, kind = "instrument" }: StripProps) {
  return (
    <div
      className={`device-strip ${kind}${collapsed ? " collapsed" : ""}`}
      onDoubleClick={(e) => {
        // Not when double-clicking one of the strip's own buttons.
        if ((e.target as HTMLElement).closest("button")) return;
        onToggleCollapse();
      }}
      title={collapsed ? `${name}: double-click to expand` : `${name}: double-click to collapse`}
    >
      {power ? (
        <button
          className={`strip-power${power.on ? " on" : ""}`}
          aria-label={`${name} ${power.on ? "on" : "off"}`}
          aria-pressed={power.on}
          onClick={power.onToggle}
          title={power.on ? `Turn ${name} off` : `Turn ${name} on`}
        >
          <span aria-hidden="true" />
        </button>
      ) : status ? (
        <span className={`engine ${status}`} title={`${name} engine: ${STATUS[status]}`}><span className="dot" aria-hidden="true" /></span>
      ) : null}
      <span className="strip-name">{name}</span>
      <span className="spacer" />
      {live && <span className="strip-live" title="Working in the background" aria-label="working" />}
      <button className="strip-collapse" onClick={onToggleCollapse} aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
        title={collapsed ? "Expand (or double-click the strip)" : "Collapse (or double-click the strip)"}>
        {collapsed ? "▸" : "◂"}
      </button>
      {onOpen && (
        <button className="strip-open" onClick={onOpen} aria-label={`Open ${name} in the panel`} title={`Open ${name} in the panel`}>⤢</button>
      )}
    </div>
  );
}

/** One section of a device, with its current value; clicking opens that section. */
export function Tile({ label, value, onClick, title }: { label: string; value: ReactNode; onClick: () => void; title?: string }) {
  return (
    <button className="tile" onClick={onClick} title={title ?? `Open ${label.toLowerCase()} in the panel`}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
    </button>
  );
}

/** A compact rack card: the strip, then (unless collapsed) the tiles and the essentials. */
export function RackCard({ strip, tiles, children, collapsed, className }: {
  strip: ReactNode;
  tiles?: ReactNode;
  children?: ReactNode;
  collapsed: boolean;
  className?: string;
}) {
  return (
    <section className={`rack-card${collapsed ? " collapsed" : ""}${className ? ` ${className}` : ""}`}>
      {strip}
      {!collapsed && tiles && <div className="rack-tiles">{tiles}</div>}
      {!collapsed && children && <div className="rack-essentials">{children}</div>}
    </section>
  );
}
