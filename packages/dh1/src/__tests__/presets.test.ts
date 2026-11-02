import { describe, expect, it } from "vitest";
import {
  applyPreset, DEFAULT_PRESET_ID, FACTORY_PRESETS, matchesPreset, parsePreset, PresetError, presetRef, stepPreset, toFile,
  type Preset,
} from "../presets";
import { DEFAULT_SETTINGS, requestOf } from "../settings";

const mine: Preset = {
  id: "p-1", name: "Wide net", revision: 4, savedAt: "2026-11-02T10:00:00Z",
  settings: { model: "claude-haiku-5-5", effort: "xhigh", maxIterations: 50 },
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
    expect(preset.settings).toEqual({ model: DEFAULT_SETTINGS.model, effort: "high", maxIterations: DEFAULT_SETTINGS.maxIterations });
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
