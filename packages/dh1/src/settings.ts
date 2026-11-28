// The face's settings, and turning them into a run request. Kept in localStorage between
// launches. The agent settings (AGENT_KEYS) are what a preset stores.

import {
  DEFAULT_COMPRESSOR, DEFAULT_DATA, DEFAULT_MODEL,
  type CompressorSettings, type DataSettings, type ModelSettings,
} from "@dh/parts";
import type { AgentConfig, RunRequest, Source } from "./harness";
import type { Slot, SlotSettings } from "./ab";
import type { PresetRef } from "./presets";

// The model list, TPC-H scales and file naming live with the system utilities (@dh/parts).
export { fileName, MODELS, tableNameFor, TPCH_SCALES, type SourceKind } from "@dh/parts";

/** DH-1's face: the three system utilities' settings (MODEL and COMPRESSOR are the agent
 *  settings a preset stores; DATA is the source), plus the prompt, preset and A/B. */
export interface FaceSettings extends ModelSettings, CompressorSettings, DataSettings {
  prompt: string;
  /** The preset the knobs were loaded from, or null. */
  presetId: string | null;
  // --- A/B (see ab.ts) ---
  /** The slot the face is showing. */
  abSlot: Slot;
  /** The other slot's knobs and preset; null until it's first used (then a copy). */
  abOther: SlotSettings | null;
}

/** The agent's own defaults (duckdb_agent/config.py); the server's hello confirms them. */
export const DEFAULT_SETTINGS: FaceSettings = {
  ...DEFAULT_MODEL,
  ...DEFAULT_COMPRESSOR,
  ...DEFAULT_DATA,
  prompt: "Which 5 customers spent the most in 1997?",
  presetId: "factory-balanced", // the defaults above are the Balanced preset (presets.ts)
  abSlot: "A",
  abOther: null,
};

/** The settings a preset stores, and the AgentConfig field each one sets. */
export const AGENT_FIELDS = {
  model: "model",
  effort: "effort",
  maxIterations: "max_iterations",
  maxResultRows: "max_result_rows",
  maxResultChars: "max_result_chars",
  maxCellChars: "max_cell_chars",
  queryTimeoutSeconds: "query_timeout_seconds",
  maxTokens: "max_tokens",
  structuredAnswer: "structured_answer",
  promptCaching: "prompt_caching",
  contextEditing: "context_editing",
  contextTriggerTokens: "context_trigger_tokens",
  contextKeepToolUses: "context_keep_tool_uses",
  contextClearAtLeastTokens: "context_clear_at_least_tokens",
  contextProtectedTools: "context_protected_tools",
} as const satisfies Partial<Record<keyof FaceSettings, keyof AgentConfig>>;

export type AgentKey = keyof typeof AGENT_FIELDS;
export const AGENT_KEYS = Object.keys(AGENT_FIELDS) as AgentKey[];
export type AgentSettings = Pick<FaceSettings, AgentKey>;

export function agentSettingsOf(settings: FaceSettings): AgentSettings {
  const out = {} as Record<AgentKey, unknown>;
  for (const key of AGENT_KEYS) {
    const value = settings[key];
    out[key] = Array.isArray(value) ? [...value] : value;
  }
  return out as AgentSettings;
}

/** Whether a value has the same type as the default for that setting (for reading
 *  saved settings and presets written by other versions). */
export function validSetting(key: AgentKey, value: unknown): boolean {
  const fallback = DEFAULT_SETTINGS[key];
  if (Array.isArray(fallback)) return Array.isArray(value) && value.every((v) => typeof v === "string");
  if (typeof fallback === "number") {
    // Whole numbers, positive, except counts that can be 0.
    const zeroOk = key === "contextKeepToolUses" || key === "contextClearAtLeastTokens";
    return typeof value === "number" && Number.isFinite(value) && (zeroOk ? value >= 0 : value > 0)
      && (key === "queryTimeoutSeconds" || Number.isInteger(value));
  }
  return typeof value === typeof fallback;
}

export function sameAgentSetting(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])
    : a === b;
}

const STORAGE_KEY = "dh1.face";

export function loadSettings(): FaceSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && typeof saved === "object") return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    // Unreadable or blocked storage: start from defaults.
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: FaceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not worth interrupting anyone over.
  }
}

/** Why the current settings can't run yet, or null if they can. */
export function sourceProblem(settings: FaceSettings): string | null {
  if (settings.sourceKind === "db" && !settings.dbPath.trim()) return "Choose a database file or paste a path";
  if (settings.sourceKind === "files" && settings.files.length === 0) return "Add data files";
  return null;
}

export function sourceOf(settings: FaceSettings): Source {
  switch (settings.sourceKind) {
    case "tpch":
      return { tpch: settings.tpchScale };
    case "db":
      return { db: settings.dbPath.trim() };
    case "files":
      return { load: settings.files };
  }
}

export function configOf(settings: FaceSettings): AgentConfig {
  const config: Record<string, unknown> = {};
  for (const key of AGENT_KEYS) config[AGENT_FIELDS[key]] = settings[key];
  return config as AgentConfig;
}

export function requestOf(settings: FaceSettings, preset?: PresetRef, labels?: RunRequest["labels"]): RunRequest {
  return {
    prompt: settings.prompt.trim(),
    source: sourceOf(settings),
    config: configOf(settings),
    ...(preset ? { preset } : {}),
    ...(labels ? { labels } : {}),
  };
}
