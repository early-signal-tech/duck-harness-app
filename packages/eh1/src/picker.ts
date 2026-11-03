// What the setlist picker says about each setlist: its title, how far it ran, how much is
// graded with the face's settings, which presets it compared and what differed between
// them, and whether it matches a search. Pure functions; SetlistPicker.tsx draws them.

import type { QuestionSet } from "@dh/formats";
import type { SetlistInfo, SetlistPreset } from "./engine";

export const MAX_NAME = 80;
export const MAX_NOTE = 200;

/** Whitespace tidied and cut to `max` (as DH-1's cleanName and the engine's clean_text). */
export function cleanText(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export function whenOf(s: SetlistInfo): string {
  if (!s.started_at) return "";
  const when = new Date(s.started_at);
  return `${when.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
}

export function shapeOf(s: SetlistInfo): string {
  return `${s.columns} preset${s.columns === 1 ? "" : "s"} × ${s.repeats ?? 1}`;
}

/** The title a setlist gets without a name: its set, shape, and start time. */
export function suggestedTitle(s: SetlistInfo, setName?: string): string {
  return [setName ?? s.question_set, shapeOf(s), whenOf(s)].filter(Boolean).join(" · ");
}

/** A setlist's title: its name, or its facts. */
export function setlistTitle(s: SetlistInfo, setName?: string): string {
  return s.name || suggestedTitle(s, setName);
}

/** What a rename stores: your words, or null when you left the suggestion as it was. */
export function nameToStore(typed: string, s: SetlistInfo, setName?: string): string | null {
  const name = cleanText(typed, MAX_NAME);
  return !name || name === suggestedTitle(s, setName) ? null : name;
}

// --- how far it ran ---

export interface RunStatus {
  kind: "complete" | "running" | "stopped";
  label: string;
}

/** A setlist still writing runs this recently counts as running, not stopped. */
const RECENT_MS = 5 * 60_000;

/** Runs that finished (anything but cancelled) against what the setlist planned, which is
 *  every question × preset × repeat when the set is known. */
export function runStatus(s: SetlistInfo, set: QuestionSet | null, now = Date.now()): RunStatus {
  const finished = s.runs - (s.cancelled ?? 0);
  const planned = set ? set.questions.length * s.columns * (s.repeats ?? 1) : null;
  if ((s.cancelled ?? 0) === 0 && (planned === null || finished >= planned)) return { kind: "complete", label: "COMPLETE" };
  const of = `${finished}/${planned ?? s.runs}`;
  const last = s.ended_at ? new Date(s.ended_at).getTime() : 0;
  if ((s.cancelled ?? 0) === 0 && now - last < RECENT_MS) return { kind: "running", label: `RUNNING ${of}` };
  return { kind: "stopped", label: `STOPPED ${of}` };
}

// --- how much is graded ---

export type GradeKind = "graded" | "partial" | "other" | "none";

export interface GradeStatus {
  kind: GradeKind;
  label: string;
  title: string;
}

export function gradeStatus(s: SetlistInfo): GradeStatus | null {
  const g = s.grading;
  if (!g) return null;
  if (g.graded === 0) {
    return g.other_settings > 0
      ? { kind: "other", label: "OTHER SETTINGS", title: "Graded, but with other judge settings or another revision of the question set. Not graded with these." }
      : { kind: "none", label: "NOT GRADED", title: "Not graded yet" };
  }
  if (g.graded < s.runs) return { kind: "partial", label: `GRADED ${g.graded}/${s.runs}`, title: "Partly graded with these settings" };
  return {
    kind: "graded",
    label: g.total === null ? "GRADED" : `GRADED · AVG ${g.total.toFixed(1)}/6`,
    title: "Every run is graded with these settings",
  };
}

export type GradeFilter = "all" | "not-graded" | "graded";

/** GRADED: anything graded with these settings; NOT GRADED: nothing is (yet). */
export function passesFilter(s: SetlistInfo, filter: GradeFilter): boolean {
  if (filter === "all" || !s.grading) return true;
  return filter === "graded" ? s.grading.graded > 0 : s.grading.graded === 0;
}

// --- which presets it compared ---

const CONFIG_NAMES: Record<string, string> = {
  model: "model",
  effort: "effort",
  max_iterations: "iterations",
  max_tokens: "max tokens",
  max_result_rows: "rows",
  max_result_chars: "result chars",
  max_cell_chars: "cell chars",
  query_timeout_seconds: "timeout",
  system_prompt: "system prompt",
  structured_answer: "structured answer",
  prompt_caching: "caching",
  context_editing: "context editing",
  context_trigger_tokens: "context trigger",
  context_keep_tool_uses: "kept tool uses",
  context_clear_at_least_tokens: "context clear",
  context_protected_tools: "protected tools",
};

const configName = (key: string) => CONFIG_NAMES[key] ?? key.replace(/_/g, " ");

function showValue(key: string, value: unknown): string {
  if (typeof value === "string") return key === "model" ? value.replace(/^claude-/, "") : value;
  return JSON.stringify(value);
}

export function presetNames(presets: SetlistPreset[]): string {
  return presets.map((p) => `${p.name ?? "No preset"}${p.modified ? " (edited)" : ""}`).join(" · ");
}

/** What differed between the columns' configs: one setting with its values ("effort low /
 *  medium / high"), or the names of several. `full` lists every one with its values. */
export function differs(presets: SetlistPreset[]): { short: string; full: string } {
  if (presets.length < 2) return { short: "one preset", full: "One preset: nothing to compare." };
  const keys = [...new Set(presets.flatMap((p) => Object.keys(p.config)))].sort();
  const changed = keys.filter((k) => new Set(presets.map((p) => JSON.stringify(p.config[k] ?? null))).size > 1);
  if (!changed.length) return { short: "same settings", full: "Every column ran the same settings." };
  // The system prompt is stored as a hash: say it differs, not what it is.
  const values = (k: string) => (k === "system_prompt" ? "differs" : presets.map((p) => showValue(k, p.config[k] ?? "–")).join(" / "));
  const full = changed.map((k) => `${configName(k)}: ${values(k)}`).join("\n");
  if (changed.length === 1) {
    const k = changed[0];
    return { short: k === "system_prompt" ? "system prompt" : `${configName(k)} ${values(k)}`, full };
  }
  const shown = changed.slice(0, 4).map(configName);
  return { short: shown.join(", ") + (changed.length > shown.length ? ` +${changed.length - shown.length}` : ""), full };
}

// --- finding one ---

/** Every word of the query appears in the setlist's title, note, ID, set, presets, or date. */
export function matchesSearch(s: SetlistInfo, query: string, setName?: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [setlistTitle(s, setName), s.note, s.id, s.question_set, setName, presetNames(s.presets ?? []), whenOf(s)]
    .filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

export interface PickerGroup {
  questionSet: string;
  set: QuestionSet | null;
  /** Newest first. */
  setlists: SetlistInfo[];
  /** The newest setlist of this set (shown LATEST), whether or not it passed the filter. */
  latest: string;
}

/** Setlists (newest first) grouped by question set, the set with the newest first. */
export function groupSetlists(setlists: SetlistInfo[], shown: (s: SetlistInfo) => boolean, setOf: (id: string) => QuestionSet | null): PickerGroup[] {
  const groups = new Map<string, PickerGroup>();
  for (const s of setlists) {
    let group = groups.get(s.question_set);
    if (!group) {
      group = { questionSet: s.question_set, set: setOf(s.question_set), setlists: [], latest: s.id };
      groups.set(s.question_set, group);
    }
    if (shown(s)) group.setlists.push(s);
  }
  return [...groups.values()].filter((g) => g.setlists.length);
}
