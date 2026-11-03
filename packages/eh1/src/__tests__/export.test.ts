import { describe, expect, it } from "vitest";
import type { QuestionSet } from "@dh/formats";
import type { Grade, SetlistInfo } from "../engine";
import { csvField, csvFileName, gradesCsv, gradesSql } from "../exportGrades";
import { docForLink } from "../HelpView";
import eh1Handbook from "../../../../docs/EH1_HANDBOOK.md?raw";
import { slugify } from "@dh/ui-kit";

const set: QuestionSet = {
  id: "eval", name: "Eval", description: "", revision: 2, savedAt: "",
  categories: [{ id: "A", name: "Basics" }, { id: "B", name: "More" }],
  questions: [
    { id: "B1", title: "Two", prompt: "p", tags: [], category: "B" },
    { id: "A1", title: "One, with a comma", prompt: "p", tags: [], category: "A" },
  ],
};
const setlist: SetlistInfo = {
  id: "sl-1", question_set: "eval", revision: 2, name: null, note: null, concurrency: 1, runs: 2, completed: 2, columns: 2,
  repeats: 1, cost_usd: null, started_at: null, ended_at: null,
  presets: [{ column: "A", name: "Quick", modified: false, config: {} }, { column: "B", name: "Deep", modified: true, config: {} }],
};
const g = (question: string, column: string, over: Partial<Grade> = {}): Grade => ({
  run_id: `${question}-${column}`, question, column, repeat: 1, status: "completed", correct: 2, careful: 1, efficient: 2,
  correct_reason: 'Says "100".', careful_reason: null, efficient_reason: "3 iterations", judge_unsure: false, judge_values: null,
  rules: [{ label: "no failed queries", passed: false, detail: "" }], rules_passed: false, judge_cost_usd: 0.001, judge_error: null,
  override: null, run_cost_usd: 0.002, ...over,
});

describe("exporting grades", () => {
  it("quotes CSV fields only when needed", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('a "b", c')).toBe('"a ""b"", c"');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField(null)).toBe("");
  });

  it("writes one row per grade in scorecard order, yours and the judge's scores", () => {
    const csv = gradesCsv(setlist, set, [g("B1", "A"), g("A1", "B", { override: { correct: 0, careful: 0, why: "wrong" } })]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    const head = lines[0].split(",");
    const row = (i: number) => Object.fromEntries(head.map((h, j) => [h, lines[i].match(/("([^"]|"")*"|[^,]*)(,|$)/g)![j].replace(/,$/, "")]));
    expect(row(1).question).toBe("A1");
    expect(row(1).title).toBe('"One, with a comma"');
    expect([row(1).correct, row(1).judge_correct, row(1).overridden, row(1).override_why, row(1).preset]).toEqual(["0", "2", "yes", "wrong", "Deep (edited)"]);
    expect([row(2).question, row(2).total, row(2).rules_broken]).toEqual(["B1", "5", "no failed queries"]);
    expect(csvFileName(setlist, new Date("2026-11-03T12:00:00Z"))).toBe("sl-1-grades-2026-11-03.csv");
  });

  it("writes the shell query with escaped literals", () => {
    const sql = gradesSql("sl-'x", "abc");
    expect(sql).toContain("g.setlist_run = 'sl-''x' AND g.grader_key = 'abc'");
  });
});

describe("the EH-1 handbook", () => {
  it("has a working contents list and opens the bundled docs it links to", () => {
    const anchors = [...eh1Handbook.matchAll(/^\d+\. \[[^\]]+\]\(#([^)]+)\)/gm)].map((m) => m[1]);
    const headings = new Set([...eh1Handbook.matchAll(/^## (.+)$/gm)].map((m) => slugify(m[1])));
    expect(anchors.length).toBeGreaterThan(15);
    expect(anchors.filter((a) => !headings.has(a))).toEqual([]);
    expect(docForLink("QUESTION_SETS.md")).toBe("question-sets");
    expect(docForLink("HANDBOOK.md#14-setlist")).toBe("dh1");
    expect(docForLink("../README.md")).toBeNull();
  });
});
