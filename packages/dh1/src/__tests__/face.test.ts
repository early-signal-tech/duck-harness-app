import { describe, expect, it } from "vitest";
import { stepTextSize } from "../layout";
import { requestOf, DEFAULT_SETTINGS, sourceProblem } from "../settings";

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

describe("pane layout", () => {
  it("steps text size along the list and stops at the ends", () => {
    expect(stepTextSize(14, 1)).toBe(15);
    expect(stepTextSize(14, -1)).toBe(13);
    expect(stepTextSize(20, 1)).toBe(20);
    expect(stepTextSize(11, -1)).toBe(11);
    expect(stepTextSize(17, 1)).toBe(18); // a saved size between steps snaps onto the list
  });

});
