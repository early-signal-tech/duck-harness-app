// The face's settings, and turning them into a run request. Kept in localStorage between
// launches as a convenience; saved presets come later and will build on this shape.

import type { AgentConfig, Effort, RunRequest, Source } from "./harness";

export const MODELS = [
  { id: "claude-haiku-5-5", label: "HAIKU" },
  { id: "claude-sonnet-5-5", label: "SONNET" },
  { id: "claude-opus-5-5", label: "OPUS" },
] as const;

export const TPCH_SCALES = [0.01, 0.1, 1] as const;

export type SourceKind = "tpch" | "db" | "files";

export interface FaceSettings {
  model: string;
  effort: Effort;
  maxIterations: number;
  sourceKind: SourceKind;
  tpchScale: number;
  dbPath: string;
  files: string[];
  prompt: string;
}

export const DEFAULT_SETTINGS: FaceSettings = {
  model: "claude-haiku-5-5",
  effort: "medium",
  maxIterations: 25,
  sourceKind: "tpch",
  tpchScale: 0.1,
  dbPath: "",
  files: [],
  prompt: "Which 5 customers spent the most in 1997?",
};

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
  if (settings.sourceKind === "db" && !settings.dbPath.trim()) return "Choose a database file";
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
  return { model: settings.model, effort: settings.effort, max_iterations: settings.maxIterations };
}

export function requestOf(settings: FaceSettings): RunRequest {
  return { prompt: settings.prompt.trim(), source: sourceOf(settings), config: configOf(settings) };
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** The table a loaded file becomes, as the agent names it (duckdb_agent/sources.py):
 *  data/Sales 2026.csv.gz -> sales_2026. */
export function tableNameFor(path: string): string {
  const stem = fileName(path).split(".")[0];
  return stem.replace(/\W+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "data";
}
