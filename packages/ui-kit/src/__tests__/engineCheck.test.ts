import { describe, expect, it } from "vitest";
import { engineProblems } from "../engineCheck";

describe("engineProblems", () => {
  it("has nothing to compare with one engine", () => {
    expect(engineProblems([{ engine: "dh1" }])).toEqual([]);
  });

  it("passes engines built for the same traces", () => {
    expect(engineProblems([
      { engine: "dh1", version: "0.2.0", traces_schema: "abc" },
      { engine: "eh1", version: "0.3.0", traces_schema: "abc" },
    ])).toEqual([]);
  });

  it("names both sides of a mismatch", () => {
    const [problem] = engineProblems([
      { engine: "dh1", version: "0.2.0", traces_schema: "abc" },
      { engine: "eh1", version: "0.1.0", traces_schema: "xyz" },
    ]);
    expect(problem).toContain("DH-1's agent (0.2.0) uses traces schema abc");
    expect(problem).toContain("EH-1's grader (0.1.0) uses traces schema xyz");
  });

  it("asks to update an engine too old to say", () => {
    expect(engineProblems([{ engine: "dh1", traces_schema: "abc" }, { engine: "eh1" }]))
      .toEqual(["EH-1's grader doesn't report its traces schema: update it."]);
  });
});
