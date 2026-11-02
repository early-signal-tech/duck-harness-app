import { describe, expect, it } from "vitest";
import { copyToOther, diffSettings, settingsForSlot, slotOf, switchSlot } from "../ab";
import { agentSettingsOf, DEFAULT_SETTINGS, requestOf } from "../settings";

const face = { ...DEFAULT_SETTINGS, prompt: "same question", tpchScale: 1 };

describe("A/B slots", () => {
  it("B starts as a copy of A", () => {
    const b = switchSlot(face);
    expect(b.abSlot).toBe("B");
    expect(agentSettingsOf(b)).toEqual(agentSettingsOf(face));
  });

  it("each slot keeps its own knobs and preset; source and prompt are shared", () => {
    let f = switchSlot(face); // on B
    f = { ...f, effort: "max", maxIterations: 50, presetId: "p-1", prompt: "new question" };
    f = switchSlot(f); // back on A
    expect(f).toMatchObject({ abSlot: "A", effort: "medium", maxIterations: 25, presetId: "factory-balanced" });
    expect(f.prompt).toBe("new question");
    expect(f.tpchScale).toBe(1);
    f = switchSlot(f); // B again, as it was left
    expect(f).toMatchObject({ abSlot: "B", effort: "max", maxIterations: 50, presetId: "p-1" });
  });

  it("A → B copies the active slot over the other", () => {
    const f = copyToOther({ ...face, effort: "low", abOther: slotOf({ ...face, effort: "max" }) });
    expect(settingsForSlot(f, "B").effort).toBe("low");
  });

  it("gives each slot the settings it runs with", () => {
    const f = { ...face, abOther: slotOf({ ...face, effort: "high", contextTriggerTokens: 40_000 }) };
    expect(settingsForSlot(f, "A").effort).toBe("medium");
    expect(settingsForSlot(f, "B")).toMatchObject({ effort: "high", contextTriggerTokens: 40_000, prompt: "same question" });
  });

  it("tags a pair's runs so they can be found together", () => {
    const request = requestOf(face, undefined, { ab: "A", pair: "x1" });
    expect(request.labels).toEqual({ ab: "A", pair: "x1" });
    expect("labels" in requestOf(face)).toBe(false);
  });
});

describe("comparing settings", () => {
  it("lists only what differs, formatted for reading", () => {
    const a = agentSettingsOf(face);
    const b = { ...a, effort: "high" as const, contextTriggerTokens: 40_000, promptCaching: false, model: "claude-opus-5-5" };
    expect(diffSettings(a, b)).toEqual([
      { key: "model", label: "Model", a: "haiku 5.5", b: "opus 5.5" },
      { key: "effort", label: "Effort", a: "MEDIUM", b: "HIGH" },
      { key: "promptCaching", label: "Cache", a: "on", b: "off" },
      { key: "contextTriggerTokens", label: "Threshold", a: "80K", b: "40K" },
    ]);
    expect(diffSettings(a, a)).toEqual([]);
  });
});
