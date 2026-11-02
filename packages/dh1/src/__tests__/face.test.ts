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
    expect(requestOf({ ...DEFAULT_SETTINGS, effort: "high", maxIterations: 10, contextTriggerTokens: 60_000 }).config).toEqual({
      model: "claude-haiku-5-5", effort: "high", max_iterations: 10,
      max_result_rows: 200, max_result_chars: 20_000, max_cell_chars: 500, query_timeout_seconds: 30, max_tokens: 16_000,
      structured_answer: false, prompt_caching: true,
      context_editing: true, context_trigger_tokens: 60_000, context_keep_tool_uses: 8, context_clear_at_least_tokens: 20_000,
      context_protected_tools: ["list_tables", "describe_table"],
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
