// DH-1 presets: saved agent settings. A preset always holds how the agent runs (model,
// effort, iterations, and later the other knobs). It can also hold the source it runs on
// (the factory presets do: TPC-H at a scale that suits them). The prompt is never part of
// a preset: it's the question being asked.
//
// The file format names its device and versions, so a rack can hold presets for
// several devices and older files can be read by newer versions:
//
//   { "format": "dh-preset", "formatVersion": 1, "device": "dh1", "deviceVersion": 1,
//     "id": "…", "name": "Deep Dive", "revision": 3, "savedAt": "…",
//     "settings": { "model": "…", "effort": "high", "maxIterations": 40, … every agent knob },
//     "source": { "kind": "tpch", "tpchScale": 1 } }      <- optional

import { invoke } from "@tauri-apps/api/core";
import { parseSource, sameSource, type SourceSpec } from "@dh/formats";
import type { Effort } from "./harness";
import {
  AGENT_KEYS, agentSettingsOf, DEFAULT_SETTINGS, sameAgentSetting, validSetting,
  type AgentSettings, type FaceSettings,
} from "./settings";

export { describeSource, sameSource } from "@dh/formats";

export const DEVICE = "dh1";
export const DEVICE_VERSION = 1;
export const FORMAT = "dh-preset";
export const FORMAT_VERSION = 1;

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** The part of the face a preset stores: every agent setting (see AGENT_KEYS). */
export type PresetSettings = AgentSettings;

const AGENT_DEFAULTS: PresetSettings = agentSettingsOf(DEFAULT_SETTINGS);

/** The source a preset loads, when it has one (the shared file form, @dh/formats). */
export type PresetSource = SourceSpec;

export interface Preset {
  id: string;
  name: string;
  /** Goes up by one on every save, so traces can tell versions of a preset apart. */
  revision: number;
  savedAt: string;
  settings: PresetSettings;
  /** Loaded along with the settings, if present. */
  source?: PresetSource;
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
    settings: {
      ...AGENT_DEFAULTS, effort: "low", maxIterations: 10, maxResultRows: 100, queryTimeoutSeconds: 15, maxTokens: 8_000,
    },
    source: { kind: "tpch", tpchScale: 0.01 },
  },
  {
    id: DEFAULT_PRESET_ID, name: "Balanced (default)", revision: 1, savedAt: "2026-11-01T00:00:00Z", factory: true,
    settings: { ...AGENT_DEFAULTS },
    source: { kind: "tpch", tpchScale: 0.1 },
  },
  {
    id: "factory-deep", name: "Deep Dive", revision: 1, savedAt: "2026-11-01T00:00:00Z", factory: true,
    settings: {
      ...AGENT_DEFAULTS, effort: "high", maxIterations: 40, maxResultRows: 500, maxResultChars: 40_000,
      queryTimeoutSeconds: 60, maxTokens: 20_000,
    },
    source: { kind: "tpch", tpchScale: 1 },
  },
];

export class PresetError extends Error {}

export function settingsOf(face: FaceSettings): PresetSettings {
  return agentSettingsOf(face);
}

/** The face's current source, in preset form. */
export function presetSourceOf(face: FaceSettings): PresetSource {
  switch (face.sourceKind) {
    case "tpch":
      return { kind: "tpch", tpchScale: face.tpchScale };
    case "db":
      return { kind: "db", dbPath: face.dbPath };
    case "files":
      return { kind: "files", files: [...face.files] };
  }
}

/** The face with a preset applied: its settings, and its source if it has one. The
 *  prompt is left alone, and so is the source when the preset doesn't have one. Fields
 *  for other source kinds (a db path while on TPC-H) are kept for switching back. */
export function applyPreset(face: FaceSettings, preset: Preset): FaceSettings {
  const next: FaceSettings = { ...face, ...agentSettingsOf({ ...face, ...preset.settings }), presetId: preset.id };
  const source = preset.source;
  if (!source) return next;
  next.sourceKind = source.kind;
  if (source.kind === "tpch") next.tpchScale = source.tpchScale;
  if (source.kind === "db") next.dbPath = source.dbPath;
  if (source.kind === "files") next.files = [...source.files];
  return next;
}

/** Whether the knobs (and the source, if the preset has one) still match the preset. */
export function matchesPreset(face: FaceSettings, preset: Preset): boolean {
  const settingsMatch = AGENT_KEYS.every((key) => sameAgentSetting(face[key], preset.settings[key]));
  return settingsMatch && (!preset.source || sameSource(presetSourceOf(face), preset.source));
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
  // Each setting the file has (and that has the right type) is used; the rest are the
  // defaults, so presets saved before a knob existed still load.
  const settings = { ...AGENT_DEFAULTS } as Record<string, unknown>;
  for (const key of AGENT_KEYS) {
    if (validSetting(key, s[key])) settings[key] = Array.isArray(s[key]) ? [...(s[key] as string[])] : s[key];
  }
  if (!EFFORTS.includes(settings.effort as Effort)) settings.effort = AGENT_DEFAULTS.effort;
  return {
    ...(parseSource(d.source) ? { source: parseSource(d.source) } : {}),
    id: typeof d.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(d.id) ? d.id : newPresetId(),
    name: d.name.trim(),
    revision: Number.isInteger(d.revision) && (d.revision as number) >= 1 ? (d.revision as number) : 1,
    savedAt: typeof d.savedAt === "string" ? d.savedAt : new Date().toISOString(),
    settings: settings as PresetSettings,
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
