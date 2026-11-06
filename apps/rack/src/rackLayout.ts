// What the rack's window looks like: which devices are folded, and which one (if any)
// fills the window. A per-window convenience, kept in localStorage; it isn't app data,
// so it doesn't belong in the shared files the CLI reads.

import type { EngineStatus } from "@dh/ui-kit";

export interface RackLayout {
  folded: string[];
  full: string | null;
}

const KEY = "rack.layout";
export const DEFAULT_LAYOUT: RackLayout = { folded: [], full: null };

export function loadLayout(): RackLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!saved || typeof saved !== "object") return DEFAULT_LAYOUT;
    return {
      folded: Array.isArray(saved.folded) ? saved.folded.filter((d: unknown) => typeof d === "string") : [],
      full: typeof saved.full === "string" ? saved.full : null,
    };
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

/** Fold or unfold a device. A device that fills the window can't be folded, so folding it
 *  goes back to the rack first. */
export function setFolded(layout: RackLayout, device: string, folded: boolean): RackLayout {
  const others = layout.folded.filter((d) => d !== device);
  return {
    folded: folded ? [...others, device] : others,
    full: folded && layout.full === device ? null : layout.full,
  };
}

/** Give a device the whole window (unfolding it), or go back to the rack. */
export function setFull(layout: RackLayout, device: string, full: boolean): RackLayout {
  return full
    ? { folded: layout.folded.filter((d) => d !== device), full: device }
    : { ...layout, full: layout.full === device ? null : layout.full };
}

/** One status for several engines, for Settings: down if any is, then starting, else ready. */
export function combinedStatus(statuses: EngineStatus[]): EngineStatus {
  if (statuses.includes("down")) return "down";
  if (statuses.includes("connecting")) return "connecting";
  return "ready";
}
