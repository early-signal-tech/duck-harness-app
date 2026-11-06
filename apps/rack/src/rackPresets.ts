// Rack presets: a chain you can save and pick, like a device's presets. One file per
// preset in ~/Library/Application Support/Duck Harness/Presets/rack/<id>.json (through the
// host's preset commands, device "rack"), so the CLI can read them too.
//
// A preset holds the chain in order, and for each device what to set it to: DH-1's preset
// (by its id: DH-1's presets are their own files), and the judge settings of an EH-1 (on
// its own, or the one inside AUTO GRADER). Nothing derived is stored: a preset's display
// name is the name you gave it, and "edited" is worked out by comparing.
//
//   {"format": "dh-rack", "formatVersion": 1, "id": "rack-…", "name": "Nightly TPC-H",
//    "revision": 2, "savedAt": "…",
//    "devices": [{"type": "dh1", "preset": "factory-quick"},
//                {"type": "autograder", "grader": {"judge_model": "claude-haiku-5-5", …}}]}

import type { GraderSettings } from "@dh/eh1";
import { DEVICE_TYPES, type DeviceType } from "./chainRules";

export const FORMAT = "dh-rack";
export const FORMAT_VERSION = 1;

export interface RackSlot {
  type: DeviceType;
  /** DH-1: the id of the DH-1 preset to load. Left out: DH-1 keeps what it has. */
  preset?: string;
  /** EH-1 or AUTO GRADER's EH-1: its judge settings. Left out: it keeps what it has. */
  grader?: Partial<GraderSettings>;
}

export interface RackPreset {
  id: string;
  name: string;
  revision: number;
  savedAt: string;
  factory?: boolean;
  devices: RackSlot[];
}

export const FACTORY_RACK_PRESETS: RackPreset[] = [
  {
    id: "factory-graded", name: "DH-1 + AUTO GRADER", revision: 1, savedAt: "2026-11-06T00:00:00Z", factory: true,
    devices: [{ type: "dh1" }, { type: "autograder" }],
  },
  {
    id: "factory-dh1", name: "DH-1", revision: 1, savedAt: "2026-11-06T00:00:00Z", factory: true,
    devices: [{ type: "dh1" }],
  },
  {
    id: "factory-eh1", name: "EH-1", revision: 1, savedAt: "2026-11-06T00:00:00Z", factory: true,
    devices: [{ type: "eh1" }],
  },
];

/** The file's text for a preset (a factory flag isn't saved: files are always yours). */
export function rackPresetToFile(preset: RackPreset): string {
  const { factory: _factory, ...rest } = preset;
  return JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION, ...rest }, null, 2) + "\n";
}

/** A preset from its file's text. Throws on a file that isn't a rack preset. */
export function parseRackPreset(text: string): RackPreset {
  const data = JSON.parse(text);
  if (!data || data.format !== FORMAT) throw new Error("not a rack preset");
  if (data.formatVersion !== FORMAT_VERSION) throw new Error(`rack preset format ${data.formatVersion}; this app reads ${FORMAT_VERSION}`);
  if (typeof data.id !== "string" || typeof data.name !== "string" || !Array.isArray(data.devices)) {
    throw new Error("a rack preset needs an id, a name, and its devices");
  }
  const devices: RackSlot[] = data.devices
    .filter((d: unknown): d is RackSlot => !!d && typeof d === "object" && DEVICE_TYPES.includes((d as RackSlot).type))
    .map((d: RackSlot) => ({
      type: d.type,
      ...(typeof d.preset === "string" ? { preset: d.preset } : {}),
      ...(d.grader && typeof d.grader === "object" ? { grader: d.grader } : {}),
    }));
  return {
    id: data.id,
    name: data.name,
    revision: Number.isInteger(data.revision) ? data.revision : 1,
    savedAt: typeof data.savedAt === "string" ? data.savedAt : "",
    devices,
  };
}

/** A new preset's id: unique, and a safe file name. */
export function newRackPresetId(): string {
  return `rack-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** What the rack is set to now, in a preset's terms. */
export interface RackState {
  chain: DeviceType[];
  dh1Preset: string | null;
  /** The judge settings of each EH-1 in the chain. */
  graders: Partial<Record<"eh1" | "autograder", GraderSettings>>;
}

/** The rack's state as preset slots, for saving. */
export function slotsOf(state: RackState): RackSlot[] {
  return state.chain.map((type) => {
    if (type === "dh1") return state.dh1Preset ? { type, preset: state.dh1Preset } : { type };
    const grader = state.graders[type];
    return grader ? { type, grader: { ...grader } } : { type };
  });
}

/** Whether the rack has moved away from `preset`: a different chain, another DH-1 preset,
 *  or other judge settings. What the preset leaves out doesn't count. */
export function rackEdited(preset: RackPreset, state: RackState): boolean {
  if (preset.devices.length !== state.chain.length) return true;
  return preset.devices.some((slot, i) => {
    if (slot.type !== state.chain[i]) return true;
    if (slot.type === "dh1") return slot.preset !== undefined && slot.preset !== state.dh1Preset;
    const grader = state.graders[slot.type as "eh1" | "autograder"];
    if (!slot.grader || !grader) return false;
    return Object.entries(slot.grader).some(([key, value]) => grader[key as keyof GraderSettings] !== value);
  });
}

/** The next preset in the list, wrapping round (‹ and ›). */
export function stepRackPreset(all: RackPreset[], currentId: string | null, direction: 1 | -1): RackPreset | null {
  if (all.length === 0) return null;
  const index = all.findIndex((p) => p.id === currentId);
  if (index < 0) return all[0];
  return all[(index + direction + all.length) % all.length];
}
