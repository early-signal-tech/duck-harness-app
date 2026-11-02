// A/B: two sets of agent settings on one face, like a hardware plugin's A/B compare.
// The face always shows the active slot; the other slot's knobs and preset are stored
// beside it (FaceSettings.abOther), and switching swaps them. The source and prompt
// are shared: same data, same question, two settings.

import {
  AGENT_KEYS, agentSettingsOf, sameAgentSetting, type AgentKey, type AgentSettings, type FaceSettings,
} from "./settings";

export type Slot = "A" | "B";

export interface SlotSettings {
  agent: AgentSettings;
  presetId: string | null;
}

export const otherSlot = (slot: Slot): Slot => (slot === "A" ? "B" : "A");

export function slotOf(face: FaceSettings): SlotSettings {
  return { agent: agentSettingsOf(face), presetId: face.presetId };
}

/** The face with a slot's knobs and preset in place (source and prompt unchanged). */
export function withSlot(face: FaceSettings, slot: SlotSettings): FaceSettings {
  return { ...face, ...agentSettingsOf({ ...face, ...slot.agent }), presetId: slot.presetId };
}

/** The other slot's stored settings; until it's been set, it starts as a copy. */
export function storedOther(face: FaceSettings): SlotSettings {
  return face.abOther ?? slotOf(face);
}

/** Flip to the other slot: its settings come onto the face, and the face's are stored. */
export function switchSlot(face: FaceSettings): FaceSettings {
  return { ...withSlot(face, storedOther(face)), abSlot: otherSlot(face.abSlot), abOther: slotOf(face) };
}

/** Copy the active slot's settings over the other slot (A → B, or B → A). */
export function copyToOther(face: FaceSettings): FaceSettings {
  return { ...face, abOther: slotOf(face) };
}

/** The full settings a slot runs with. */
export function settingsForSlot(face: FaceSettings, slot: Slot): FaceSettings {
  return slot === face.abSlot ? face : withSlot(face, storedOther(face));
}

// --- comparing settings ---

const LABELS: Record<AgentKey, string> = {
  model: "Model",
  effort: "Effort",
  maxIterations: "Iterations",
  maxResultRows: "Result rows",
  maxResultChars: "Result chars",
  maxCellChars: "Cell clip",
  queryTimeoutSeconds: "Timeout",
  maxTokens: "Max tokens",
  structuredAnswer: "Structured",
  promptCaching: "Cache",
  contextEditing: "Compressor",
  contextTriggerTokens: "Threshold",
  contextKeepToolUses: "Keep",
  contextClearAtLeastTokens: "Clear ≥",
  contextProtectedTools: "Sidechain",
};

const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K`.replace(".0K", "K") : String(n));

export function formatSetting(key: AgentKey, value: unknown): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (key === "model") return String(value).replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2");
  if (key === "effort") return String(value).toUpperCase();
  if (key === "queryTimeoutSeconds") return `${value} s`;
  if (key === "maxResultChars" || key === "maxTokens" || key.startsWith("context")) return tokens(value as number);
  return String(value);
}

export interface SettingDiff {
  key: AgentKey;
  label: string;
  a: string;
  b: string;
}

/** The settings that differ between A and B, in panel order. */
export function diffSettings(a: AgentSettings, b: AgentSettings): SettingDiff[] {
  return AGENT_KEYS.filter((key) => !sameAgentSetting(a[key], b[key])).map((key) => ({
    key,
    label: LABELS[key],
    a: formatSetting(key, a[key]),
    b: formatSetting(key, b[key]),
  }));
}
