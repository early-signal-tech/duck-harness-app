// What each system utility sets, and its defaults. DH-1's face settings are these three
// put together (plus its prompt, preset and A/B), so a run is the same whichever device
// the knobs sit on. The defaults are the agent's own (duckdb_agent/config.py).

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const MODELS = [
  { id: "claude-haiku-5-5", label: "HAIKU" },
  { id: "claude-sonnet-5-5", label: "SONNET" },
  { id: "claude-opus-5-5", label: "OPUS" },
] as const;

export const TPCH_SCALES = [0.01, 0.1, 1] as const;

export type SourceKind = "tpch" | "db" | "files";

/** DATA: what the agent queries. */
export interface DataSettings {
  sourceKind: SourceKind;
  tpchScale: number;
  dbPath: string;
  files: string[];
}

/** MODEL: the model and how the agent runs. */
export interface ModelSettings {
  model: string;
  effort: Effort;
  maxIterations: number;
  maxResultRows: number;
  maxResultChars: number;
  maxCellChars: number;
  queryTimeoutSeconds: number;
  maxTokens: number;
  structuredAnswer: boolean;
  promptCaching: boolean;
}

/** COMPRESSOR: context editing. */
export interface CompressorSettings {
  contextEditing: boolean;
  contextTriggerTokens: number;
  contextKeepToolUses: number;
  contextClearAtLeastTokens: number;
  contextProtectedTools: string[];
}

export const DEFAULT_DATA: DataSettings = {
  sourceKind: "tpch",
  tpchScale: 0.1,
  dbPath: "",
  files: [],
};

export const DEFAULT_MODEL: ModelSettings = {
  model: "claude-haiku-5-5",
  effort: "medium",
  maxIterations: 25,
  maxResultRows: 200,
  maxResultChars: 20_000,
  maxCellChars: 500,
  queryTimeoutSeconds: 30,
  maxTokens: 16_000,
  structuredAnswer: false,
  promptCaching: true,
};

export const DEFAULT_COMPRESSOR: CompressorSettings = {
  contextEditing: true,
  contextTriggerTokens: 80_000,
  contextKeepToolUses: 8,
  contextClearAtLeastTokens: 20_000,
  contextProtectedTools: ["list_tables", "describe_table"],
};

/** What MODEL reads from the engine's hello, when there is one. */
export interface EngineInfo {
  defaults: { effort: Effort; max_iterations: number };
  /** The largest max_tokens a non-streaming call allows; absent from older servers. */
  limits?: { max_tokens: number };
}

/** What COMPRESSOR's meters read from the run it's set up for. */
export interface CompressorReading {
  phase: string;
  contextTokens: number;
  /** Largest prompt seen this run. */
  peakContextTokens: number;
  clears: { tokens: number }[];
}

/** A meter that isn't reading anything yet. */
export const NO_READING: CompressorReading = { phase: "idle", contextTokens: 0, peakContextTokens: 0, clears: [] };

export const kTokens = (n: number) => (n === 0 ? "0" : n >= 1000 ? `${Math.round(n / 100) / 10}K`.replace(".0K", "K") : String(n));

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** The table a loaded file becomes, as the agent names it (duckdb_agent/sources.py):
 *  data/Sales 2026.csv.gz -> sales_2026. */
export function tableNameFor(path: string): string {
  const stem = fileName(path).split(".")[0];
  return stem.replace(/\W+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "data";
}
