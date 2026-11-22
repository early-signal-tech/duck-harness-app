import { describe, expect, it } from "vitest";
import {
  FACTORY_RACK_PRESETS, parseRackPreset, rackEdited, rackPresetToFile, slotsOf, stepRackPreset, type RackPreset, type RackState,
} from "../rackPresets";

const haiku = { name: "Standard rubric", revision: 1, judge_model: "claude-haiku-5-5", judge_effort: "low", tolerance: "±0.5%",
  iteration_budget: 8, instructions: "", waste_for_one: 2 };

const state: RackState = { chain: ["dh1", "autograder"], dh1Preset: "factory-quick", graders: { autograder: haiku } };

describe("rack presets", () => {
  it("saves the chain, DH-1's preset, and the judge settings, and reads them back", () => {
    const preset: RackPreset = { id: "rack-x", name: "Nightly", revision: 2, savedAt: "2026-11-06T10:00:00Z", devices: slotsOf(state) };
    const text = rackPresetToFile(preset);
    expect(JSON.parse(text)).toMatchObject({ format: "dh-rack", formatVersion: 1, name: "Nightly",
      devices: [{ type: "dh1", preset: "factory-quick" }, { type: "autograder", grader: { judge_model: "claude-haiku-5-5" } }] });
    expect(parseRackPreset(text)).toEqual(preset);
  });

  it("doesn't save the factory flag, and skips devices it doesn't know", () => {
    expect(JSON.parse(rackPresetToFile(FACTORY_RACK_PRESETS[0])).factory).toBeUndefined();
    const text = JSON.stringify({ format: "dh-rack", formatVersion: 1, id: "r", name: "R", devices: [{ type: "dh1" }, { type: "synth" }] });
    expect(parseRackPreset(text).devices).toEqual([{ type: "dh1" }]);
  });

  it("refuses files that aren't rack presets", () => {
    expect(() => parseRackPreset(JSON.stringify({ format: "dh-preset" }))).toThrow("not a rack preset");
    expect(() => parseRackPreset(JSON.stringify({ format: "dh-rack", formatVersion: 9 }))).toThrow("format 9");
  });

  it("knows when the rack has moved away from its preset", () => {
    const saved: RackPreset = { id: "r", name: "R", revision: 1, savedAt: "", devices: slotsOf(state) };
    expect(rackEdited(saved, state)).toBe(false);
    expect(rackEdited(saved, { ...state, dh1Preset: "factory-deep" })).toBe(true);
    expect(rackEdited(saved, { ...state, graders: { autograder: { ...haiku, judge_model: "claude-sonnet-5-5" } } })).toBe(true);
    expect(rackEdited(saved, { ...state, chain: ["dh1"] })).toBe(true);
    // A factory preset that leaves DH-1's preset open doesn't care which one is loaded.
    expect(rackEdited(FACTORY_RACK_PRESETS[0], { ...state, dh1Preset: "anything" })).toBe(false);
  });

  it("has a PB-1 preset: PB-1 on its own, with nothing else to save", () => {
    const pb1 = FACTORY_RACK_PRESETS.find((p) => p.id === "factory-pb1");
    expect(pb1?.devices).toEqual([{ type: "pb1" }]);
    const alone: RackState = { chain: ["pb1"], dh1Preset: null, graders: {} };
    expect(slotsOf(alone)).toEqual([{ type: "pb1" }]);
    expect(rackEdited(pb1!, alone)).toBe(false);
    expect(parseRackPreset(rackPresetToFile(pb1!)).devices).toEqual([{ type: "pb1" }]);
  });

  it("steps through presets, wrapping round", () => {
    const all = FACTORY_RACK_PRESETS;
    expect(stepRackPreset(all, all[0].id, 1)?.id).toBe(all[1].id);
    expect(stepRackPreset(all, all[0].id, -1)?.id).toBe(all[all.length - 1].id);
    expect(stepRackPreset(all, "gone", 1)?.id).toBe(all[0].id);
  });
});
