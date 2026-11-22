// What the rack's window looks like: which devices are collapsed to their strips, what
// the top panel shows (the chain's output, or one device's editor), and what PLAY makes
// (a RUN, an A/B, or a SETLIST). A per-window convenience, kept in localStorage; it isn't
// app data, so it doesn't belong in the shared files the CLI reads.

import type { EngineStatus } from "@dh/ui-kit";

/** What the panel shows: the output, or a device's editor ("autograder": the EH-1 inside). */
export type Open = "output" | "dh1" | "eh1" | "es1" | "pb1" | "autograder";
export type Take = "run" | "ab" | "setlist";

export interface RackLayout {
  /** Device instances collapsed to their strips. */
  collapsed: string[];
  open: Open;
  take: Take;
  /** The whole rack folded to a thin bar (▾ RACK, or ⌘B). */
  rackCollapsed: boolean;
}

const KEY = "rack.layout.v3";
export const DEFAULT_LAYOUT: RackLayout = { collapsed: [], open: "output", take: "run", rackCollapsed: false };

const OPENS: Open[] = ["output", "dh1", "eh1", "es1", "pb1", "autograder"];
const TAKES: Take[] = ["run", "ab", "setlist"];

/** A saved layout, cleaned: anything unknown falls back to the default. */
export function parseLayout(saved: unknown): RackLayout {
  if (!saved || typeof saved !== "object") return DEFAULT_LAYOUT;
  const s = saved as Record<string, unknown>;
  return {
    collapsed: Array.isArray(s.collapsed) ? s.collapsed.filter((d): d is string => typeof d === "string") : [],
    open: OPENS.includes(s.open as Open) ? (s.open as Open) : "output",
    take: TAKES.includes(s.take as Take) ? (s.take as Take) : "run",
    rackCollapsed: s.rackCollapsed === true,
  };
}

export function loadLayout(): RackLayout {
  try {
    return parseLayout(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: RackLayout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // a private window or blocked storage: the layout just isn't remembered
  }
}

/** Collapse a device to its strip, or expand it. */
export function toggleCollapsed(layout: RackLayout, device: string): RackLayout {
  const collapsed = layout.collapsed.includes(device)
    ? layout.collapsed.filter((d) => d !== device)
    : [...layout.collapsed, device];
  return { ...layout, collapsed };
}

/** One status for several engines, for Settings: down if any is, then starting, else ready. */
export function combinedStatus(statuses: EngineStatus[]): EngineStatus {
  if (statuses.includes("down")) return "down";
  if (statuses.includes("connecting")) return "connecting";
  return "ready";
}
