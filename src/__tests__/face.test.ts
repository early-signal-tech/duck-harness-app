import { describe, expect, it } from "vitest";
import { clampToStep, valueFromDrag } from "../components/Knob";
import { requestOf, DEFAULT_SETTINGS, sourceProblem } from "../settings";

describe("knob math", () => {
  it("snaps to steps and stays in range", () => {
    expect(clampToStep(2.4, 0, 4, 1)).toBe(2);
    expect(clampToStep(-3, 1, 50, 1)).toBe(1);
    expect(clampToStep(99, 1, 50, 1)).toBe(50);
  });

  it("covers the whole range over one full drag, and less with Shift", () => {
    expect(valueFromDrag(1, 160, 1, 50, 1)).toBe(50);
    expect(valueFromDrag(50, -160, 1, 50, 1)).toBe(1);
    expect(valueFromDrag(25, 40, 1, 50, 1)).toBe(37); // quarter of the range
    expect(valueFromDrag(25, 40, 1, 50, 1, true)).toBe(28); // a sixteenth
  });
});

describe("settings to request", () => {
  it("builds the source for each kind", () => {
    expect(requestOf(DEFAULT_SETTINGS).source).toEqual({ tpch: 0.1 });
    expect(requestOf({ ...DEFAULT_SETTINGS, sourceKind: "db", dbPath: " a.duckdb " }).source).toEqual({ db: "a.duckdb" });
    expect(requestOf({ ...DEFAULT_SETTINGS, sourceKind: "files", files: ["x.csv"] }).source).toEqual({ load: ["x.csv"] });
  });

  it("sends the knob settings as config", () => {
    expect(requestOf({ ...DEFAULT_SETTINGS, effort: "high", maxIterations: 10 }).config).toEqual({
      model: "claude-haiku-5-5", effort: "high", max_iterations: 10,
    });
  });

  it("says what's missing before a run", () => {
    expect(sourceProblem({ ...DEFAULT_SETTINGS, sourceKind: "db", dbPath: "" })).toBe("Choose a database file");
    expect(sourceProblem(DEFAULT_SETTINGS)).toBeNull();
  });
});
