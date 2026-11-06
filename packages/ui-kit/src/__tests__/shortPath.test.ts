import { describe, expect, it } from "vitest";
import { shortCommand, shortPath } from "../shortPath";

describe("short paths for Settings", () => {
  it("turns the home folder into ~ and keeps the last two folders", () => {
    expect(shortPath("/Users/ana/Documents/Github/duckdb-analytics-agent")).toBe("~/…/Github/duckdb-analytics-agent");
    expect(shortPath("/home/ana/src/eh1-grader")).toBe("~/src/eh1-grader");
  });

  it("leaves short paths alone", () => {
    expect(shortPath("/opt/dh/duck-harness-serve")).toBe("/opt/dh/duck-harness-serve");
    expect(shortPath("uv")).toBe("uv");
  });

  it("shortens long paths outside home too", () => {
    expect(shortPath("/opt/tools/duck/harness/bin/duck-harness-serve")).toBe("/…/bin/duck-harness-serve");
  });

  it("shortens every path in a command", () => {
    expect(shortCommand("uv run --project /Users/ana/Documents/Github/duckdb-analytics-agent duck-harness-serve"))
      .toBe("uv run --project ~/…/Github/duckdb-analytics-agent duck-harness-serve");
  });
});

describe("Settings' engine lines", () => {
  it("keep only the repo folder", () => {
    expect(shortCommand("uv run --project /Users/ana/Documents/Github/duckdb-analytics-agent duck-harness-serve", 1))
      .toBe("uv run --project ~/…/duckdb-analytics-agent duck-harness-serve");
  });
});
