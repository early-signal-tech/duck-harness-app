/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPRESSOR, DEFAULT_DATA, DEFAULT_MODEL, kTokens, MODELS, NO_READING, tableNameFor,
} from "../settings";

// Every source file in the package, as text.
const SOURCES = import.meta.glob("../*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("the system utilities stand alone", () => {
  it("import no device", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(4);
    for (const [file, text] of Object.entries(SOURCES)) {
      expect(text, file).not.toMatch(/from "@dh\/(dh1|ch1|eh1|es1|pb1)"/);
      expect(text, file).not.toMatch(/from "\.\.\/\.\.\//);
    }
  });
});

describe("defaults", () => {
  it("are the agent's own (duckdb_agent/config.py)", () => {
    expect(DEFAULT_MODEL).toMatchObject({ model: "claude-haiku-5-5", effort: "medium", maxIterations: 25, maxTokens: 16_000 });
    expect(DEFAULT_COMPRESSOR).toMatchObject({ contextEditing: true, contextTriggerTokens: 80_000, contextKeepToolUses: 8 });
    expect(DEFAULT_DATA).toEqual({ sourceKind: "tpch", tpchScale: 0.1, dbPath: "", files: [] });
  });

  it("don't share a setting between utilities", () => {
    const keys = [DEFAULT_MODEL, DEFAULT_COMPRESSOR, DEFAULT_DATA].flatMap(Object.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("pick a model on the list", () => {
    expect(MODELS.map((m) => m.id)).toContain(DEFAULT_MODEL.model);
  });

  it("start the meters at zero", () => {
    expect(NO_READING).toEqual({ phase: "idle", contextTokens: 0, peakContextTokens: 0, clears: [] });
  });
});

describe("formatting", () => {
  it("kTokens", () => {
    expect([0, 500, 1000, 1500, 20_000, 80_000].map(kTokens)).toEqual(["0", "500", "1K", "1.5K", "20K", "80K"]);
  });

  it("tableNameFor names a file the way the agent does", () => {
    expect(tableNameFor("data/Sales 2026.csv.gz")).toBe("sales_2026");
    expect(tableNameFor("/x/---.parquet")).toBe("data");
  });
});
