// DH-1 presets: saved agent settings. A preset holds how the agent runs (model, effort,
// iterations, and later the other knobs), not what it runs on: the source and prompt are
// the input, like the signal going into an audio plugin.
//
// The file format names its device and versions, so a rack can hold presets for
// several devices and older files can be read by newer versions:
//
//   { "format": "dh-preset", "formatVersion": 1, "device": "dh1", "deviceVersion": 1,
//     "id": "…", "name": "Deep Dive", "revision": 3, "savedAt": "…",
//     "settings": { "model": "…", "effort": "high", "maxIterations": 40 } }

import { invoke } from "@tauri-apps/api/core";
import type { Effort } from "./harness";
import { DEFAULT_SETTINGS, type FaceSettings } from "./settings";

export const DEVICE = "dh1";
export const DEVICE_VERSION = 1;
export const FORMAT = "dh-preset";
export const FORMAT_VERSION = 1;

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** The part of the face a preset stores. */
export interface PresetSettings {
  model: string;
  effort: Effort;
  maxIterations: number;
}

export interface Preset {
  id: string;
  name: string;
  /** Goes up by one on every save, so traces can tell versions of a preset apart. */
  revision: number;
  savedAt: string;
  settings: PresetSettings;
  /** Built in, read-only. */
  factory?: boolean;
}

/** What a run records about its preset (agent_runs.preset). */
export interface PresetRef {
  id: string;
  name: string;
  revision: number;
  modified: boolean;
}

export const DEFAULT_PRESET_ID = "factory-balanced";

export const FACTORY_PRESETS: Preset[] = [
  {
    id: "factory-quick", name: "Quick & Cheap", revision: 1, savedAt: "2026-11-01T00:00:00Z", factory: true,
    settings: { model: "claude-haiku-5-5", effort: "low", maxIterations: 10 },
  },
  {
    id: DEFAULT_PRESET_ID, name: "Balanced (default)", revision: 1, savedAt: "2026-11-01T00:00:00Z", factory: true,
    settings: { model: "claude-haiku-5-5", effort: "medium", maxIterations: 25 },
  },
  {
    id: "factory-deep", name: "Deep Dive", revision: 1, savedAt: "2026-11-01T00:00:00Z", factory: true,
    settings: { model: "claude-haiku-5-5", effort: "high", maxIterations: 40 },
  },
];

export class PresetError extends Error {}

export function settingsOf(face: FaceSettings): PresetSettings {
  return { model: face.model, effort: face.effort, maxIterations: face.maxIterations };
}

/** The face with a preset's settings applied (source and prompt are left alone). */
export function applyPreset(face: FaceSettings, preset: Preset): FaceSettings {
  return { ...face, ...preset.settings, presetId: preset.id };
}

/** Whether the knobs still match the preset they were loaded from. */
export function matchesPreset(face: FaceSettings, preset: Preset): boolean {
  const current = settingsOf(face);
  return (Object.keys(preset.settings) as (keyof PresetSettings)[]).every((key) => current[key] === preset.settings[key]);
}

export function presetRef(face: FaceSettings, presets: Preset[]): PresetRef | undefined {
  const preset = presets.find((p) => p.id === face.presetId);
  if (!preset) return undefined;
  return { id: preset.id, name: preset.name, revision: preset.revision, modified: !matchesPreset(face, preset) };
}

/** The preset before (-1) or after (+1) the current one, wrapping around. */
export function stepPreset(presets: Preset[], currentId: string | null, direction: 1 | -1): Preset | undefined {
  if (presets.length === 0) return undefined;
  const index = presets.findIndex((p) => p.id === currentId);
  if (index < 0) return direction > 0 ? presets[0] : presets[presets.length - 1];
  return presets[(index + direction + presets.length) % presets.length];
}

export function newPresetId(): string {
  return `p-${crypto.randomUUID()}`;
}

export function toFile(preset: Preset): string {
  const { factory: _factory, ...rest } = preset;
  return JSON.stringify(
    { format: FORMAT, formatVersion: FORMAT_VERSION, device: DEVICE, deviceVersion: DEVICE_VERSION, ...rest },
    null,
    2,
  ) + "\n";
}

/** Read a preset file. Settings it doesn't have (from an older version) get the
 *  defaults; anything that isn't a DH-1 preset is refused. */
export function parsePreset(text: string): Preset {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PresetError("This file isn't a preset (it isn't JSON).");
  }
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object" || d.format !== FORMAT) throw new PresetError("This file isn't a Duck Harness preset.");
  if (d.device !== DEVICE) throw new PresetError(`This preset is for ${String(d.device)}, not DH-1.`);
  if (typeof d.formatVersion !== "number" || d.formatVersion > FORMAT_VERSION) {
    throw new PresetError("This preset was saved by a newer version of DH-1.");
  }
  if (typeof d.name !== "string" || !d.name.trim()) throw new PresetError("This preset has no name.");
  const s = (d.settings ?? {}) as Record<string, unknown>;
  const settings: PresetSettings = {
    model: typeof s.model === "string" ? s.model : DEFAULT_SETTINGS.model,
    effort: EFFORTS.includes(s.effort as Effort) ? (s.effort as Effort) : DEFAULT_SETTINGS.effort,
    maxIterations:
      Number.isInteger(s.maxIterations) && (s.maxIterations as number) >= 1 ? (s.maxIterations as number) : DEFAULT_SETTINGS.maxIterations,
  };
  return {
    id: typeof d.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(d.id) ? d.id : newPresetId(),
    name: d.name.trim(),
    revision: Number.isInteger(d.revision) && (d.revision as number) >= 1 ? (d.revision as number) : 1,
    savedAt: typeof d.savedAt === "string" ? d.savedAt : new Date().toISOString(),
    settings,
  };
}

/** Sort for the menu: by name, ignoring case. */
export function byName(a: Preset, b: Preset): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

// --- storage (files on disk, through the Rust side) ---

export async function loadUserPresets(): Promise<Preset[]> {
  const files = await invoke<string[]>("preset_list", { device: DEVICE });
  const presets: Preset[] = [];
  for (const text of files) {
    try {
      presets.push(parsePreset(text));
    } catch (e) {
      console.warn("Skipping a preset file:", e);
    }
  }
  return presets.sort(byName);
}

export async function writeUserPreset(preset: Preset): Promise<void> {
  await invoke("preset_write", { device: DEVICE, id: preset.id, contents: toFile(preset) });
}

export async function deleteUserPreset(id: string): Promise<void> {
  await invoke("preset_delete", { device: DEVICE, id });
}

export async function exportPreset(preset: Preset, path: string): Promise<void> {
  await invoke("file_write", { path, contents: toFile(preset) });
}

export async function importPreset(path: string): Promise<Preset> {
  return parsePreset(await invoke<string>("file_read", { path }));
}
