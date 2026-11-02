import { describe, expect, it } from "vitest";
import {
  applyPreset, DEFAULT_PRESET_ID, describeSource, FACTORY_PRESETS, matchesPreset, parsePreset, PresetError, presetRef,
  presetSourceOf, stepPreset, toFile,
  type Preset,
} from "../presets";
import { agentSettingsOf, DEFAULT_SETTINGS, requestOf } from "../settings";

const mine: Preset = {
  id: "p-1", name: "Wide net", revision: 4, savedAt: "2026-11-02T10:00:00Z",
  settings: { ...agentSettingsOf(DEFAULT_SETTINGS), effort: "xhigh", maxIterations: 50, contextKeepToolUses: 4 },
};

describe("presets and the face", () => {
  it("the default face is the Balanced preset, unchanged", () => {
    const balanced = FACTORY_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;
    expect(DEFAULT_SETTINGS.presetId).toBe(DEFAULT_PRESET_ID);
    expect(matchesPreset(DEFAULT_SETTINGS, balanced)).toBe(true);
  });

  it("applies only the agent settings, leaving source and prompt alone", () => {
    const face = { ...DEFAULT_SETTINGS, sourceKind: "db" as const, dbPath: "x.duckdb", prompt: "why?" };
    const next = applyPreset(face, mine);
    expect(next).toMatchObject({ effort: "xhigh", maxIterations: 50, presetId: "p-1", dbPath: "x.duckdb", prompt: "why?" });
  });

  it("knows when the knobs have moved since loading", () => {
    const face = applyPreset(DEFAULT_SETTINGS, mine);
    expect(presetRef(face, [mine])).toEqual({ id: "p-1", name: "Wide net", revision: 4, modified: false });
    expect(presetRef({ ...face, maxIterations: 49 }, [mine])?.modified).toBe(true);
    expect(presetRef({ ...face, presetId: null }, [mine])).toBeUndefined();
  });

  it("sends the preset with the run", () => {
    const ref = { id: "p-1", name: "Wide net", revision: 4, modified: true };
    expect(requestOf(DEFAULT_SETTINGS, ref).preset).toEqual(ref);
    expect("preset" in requestOf(DEFAULT_SETTINGS)).toBe(false);
  });

  it("steps through presets and wraps around", () => {
    const all = [...FACTORY_PRESETS, mine];
    expect(stepPreset(all, "p-1", 1)?.id).toBe(FACTORY_PRESETS[0].id);
    expect(stepPreset(all, FACTORY_PRESETS[0].id, -1)?.id).toBe("p-1");
    expect(stepPreset(all, null, 1)?.id).toBe(FACTORY_PRESETS[0].id);
  });
});

describe("preset files", () => {
  it("round-trips, naming the device and format versions", () => {
    const text = toFile(mine);
    expect(JSON.parse(text)).toMatchObject({ format: "dh-preset", formatVersion: 1, device: "dh1", deviceVersion: 1 });
    expect(parsePreset(text)).toEqual(mine);
  });

  it("never writes the factory flag", () => {
    expect(JSON.parse(toFile(FACTORY_PRESETS[0]))).not.toHaveProperty("factory");
  });

  it("fills settings an older file doesn't have with the defaults", () => {
    const old = JSON.stringify({ format: "dh-preset", formatVersion: 1, device: "dh1", name: "Old", settings: { effort: "high" } });
    const preset = parsePreset(old);
    expect(preset.settings).toEqual({ ...agentSettingsOf(DEFAULT_SETTINGS), effort: "high" });
    expect(preset.revision).toBe(1);
    expect(preset.id).toMatch(/^p-/);
  });

  it.each([
    ["not json", "isn't JSON"],
    [JSON.stringify({ name: "x" }), "isn't a Duck Harness preset"],
    [JSON.stringify({ format: "dh-preset", formatVersion: 1, device: "eh1", name: "x" }), "for eh1, not DH-1"],
    [JSON.stringify({ format: "dh-preset", formatVersion: 9, device: "dh1", name: "x" }), "newer version"],
    [JSON.stringify({ format: "dh-preset", formatVersion: 1, device: "dh1", name: " " }), "no name"],
  ])("refuses %s", (text, message) => {
    expect(() => parsePreset(text)).toThrow(PresetError);
    expect(() => parsePreset(text)).toThrow(message);
  });

  it("replaces an id that isn't safe for a file name", () => {
    const text = JSON.stringify({ format: "dh-preset", formatVersion: 1, device: "dh1", id: "../../etc", name: "x" });
    expect(parsePreset(text).id).toMatch(/^p-[0-9a-f-]+$/);
  });
});

describe("presets with a source", () => {
  const byId = (id: string) => FACTORY_PRESETS.find((p) => p.id === id)!;

  it("factory presets switch to Test Tone at their own TPC-H scale", () => {
    const face = { ...DEFAULT_SETTINGS, sourceKind: "db" as const, dbPath: "mine.duckdb", prompt: "keep me" };
    expect(applyPreset(face, byId("factory-quick"))).toMatchObject({ sourceKind: "tpch", tpchScale: 0.01, prompt: "keep me" });
    expect(applyPreset(face, byId(DEFAULT_PRESET_ID))).toMatchObject({ sourceKind: "tpch", tpchScale: 0.1 });
    // The db path is kept, so switching back to Line In still has it.
    expect(applyPreset(face, byId("factory-deep"))).toMatchObject({ sourceKind: "tpch", tpchScale: 1, dbPath: "mine.duckdb" });
  });

  it("counts a source change as an edit, but only for presets that hold a source", () => {
    const deep = applyPreset(DEFAULT_SETTINGS, byId("factory-deep"));
    expect(matchesPreset(deep, byId("factory-deep"))).toBe(true);
    expect(matchesPreset({ ...deep, tpchScale: 0.1 }, byId("factory-deep"))).toBe(false);
    expect(matchesPreset({ ...deep, sourceKind: "db" }, byId("factory-deep"))).toBe(false);
    const face = applyPreset(DEFAULT_SETTINGS, mine); // mine has no source
    expect(matchesPreset({ ...face, sourceKind: "files", files: ["a.csv"] }, mine)).toBe(true);
  });

  it("keeps only the fields for the source's kind", () => {
    const face = { ...DEFAULT_SETTINGS, sourceKind: "files" as const, files: ["a.csv", "b.parquet"], dbPath: "x.duckdb" };
    expect(presetSourceOf(face)).toEqual({ kind: "files", files: ["a.csv", "b.parquet"] });
    expect(describeSource(presetSourceOf(face))).toBe("2 files");
    expect(describeSource({ kind: "db", dbPath: "/data/shop.duckdb" })).toBe("shop.duckdb");
  });

  it("round-trips a source through a file, and drops one it can't use", () => {
    const withSource: Preset = { ...mine, source: { kind: "db", dbPath: "/data/shop.duckdb" } };
    expect(parsePreset(toFile(withSource))).toEqual(withSource);
    const bad = JSON.stringify({ format: "dh-preset", formatVersion: 1, device: "dh1", name: "x", source: { kind: "tpch", tpchScale: -1 } });
    expect(parsePreset(bad)).not.toHaveProperty("source");
  });
});

describe("presets hold every knob", () => {
  it("counts a change to any knob, including the compressor, as an edit", () => {
    const face = applyPreset(DEFAULT_SETTINGS, mine);
    expect(matchesPreset(face, mine)).toBe(true);
    expect(matchesPreset({ ...face, contextTriggerTokens: 60_000 }, mine)).toBe(false);
    expect(matchesPreset({ ...face, structuredAnswer: true }, mine)).toBe(false);
    // The order of protected tools doesn't matter.
    expect(matchesPreset({ ...face, contextProtectedTools: ["describe_table", "list_tables"] }, mine)).toBe(true);
  });

  it("keeps settings of the right type from a file and ignores the rest", () => {
    const text = JSON.stringify({
      format: "dh-preset", formatVersion: 1, device: "dh1", name: "x",
      settings: { maxTokens: 8000, contextKeepToolUses: 0, promptCaching: "yes", maxResultRows: -5, effort: "turbo" },
    });
    const { settings } = parsePreset(text);
    expect(settings.maxTokens).toBe(8000);
    expect(settings.contextKeepToolUses).toBe(0); // 0 is allowed for keep
    expect(settings.promptCaching).toBe(true); // "yes" isn't a boolean: default
    expect(settings.maxResultRows).toBe(DEFAULT_SETTINGS.maxResultRows);
    expect(settings.effort).toBe(DEFAULT_SETTINGS.effort);
  });
});
