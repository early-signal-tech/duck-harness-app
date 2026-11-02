import { describe, expect, it } from "vitest";
import {
  describeSource, FACTORY_QUESTION_SETS, hasCheck, parseQuestionSet, parseSource, questionSetToFile, questionSource,
  QuestionSetError,
} from "..";

const minimal = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: "dh-question-set",
    formatVersion: 1,
    id: "demo",
    name: "Demo",
    source: { kind: "tpch", tpchScale: 0.01 },
    questions: [{ id: "a", prompt: "How many orders?" }],
    ...over,
  });

describe("the factory TPC-H set", () => {
  const set = FACTORY_QUESTION_SETS.find((s) => s.id === "tpch")!;

  it("has the 22 queries, each with reference SQL and a published answer", () => {
    expect(set.factory).toBe(true);
    expect(set.questions).toHaveLength(22);
    expect(set.questions.map((q) => q.id)).toEqual(Array.from({ length: 22 }, (_, i) => `q${i + 1}`));
    for (const [i, q] of set.questions.entries()) {
      expect(q.prompt.length).toBeGreaterThan(20);
      expect(q.check?.tpchQuery).toBe(i + 1);
      expect(q.check?.sql).toMatch(/^SELECT|^WITH|^CREATE/i);
      expect(q.tags).toHaveLength(1);
    }
  });

  it("runs on TPC-H 0.01 by default, where published answers exist", () => {
    expect(set.source).toEqual({ kind: "tpch", tpchScale: 0.01 });
    expect(describeSource(questionSource(set, set.questions[0])!)).toBe("TPC-H 0.01");
  });

  it("asks for stated assumptions on the hard-to-phrase questions", () => {
    const withExpect = set.questions.filter((q) => q.check?.expect).map((q) => q.id);
    expect(withExpect).toEqual(["q19", "q22"]);
  });

  it("round-trips through a file", () => {
    const again = parseQuestionSet(questionSetToFile(set));
    expect(again).toEqual({ ...set, factory: undefined, savedAt: set.savedAt });
    expect(questionSetToFile(set)).not.toContain('"factory"');
  });
});

describe("parseQuestionSet", () => {
  it("reads a minimal set and fills in titles, tags, and revision", () => {
    const set = parseQuestionSet(minimal());
    expect(set.revision).toBe(1);
    expect(set.description).toBe("");
    expect(set.questions[0]).toEqual({ id: "a", title: "a", prompt: "How many orders?", tags: [] });
    expect(hasCheck(set.questions[0])).toBe(false);
    expect(questionSource(set, set.questions[0])).toEqual({ kind: "tpch", tpchScale: 0.01 });
  });

  it("lets a question override the set's source", () => {
    const set = parseQuestionSet(minimal({
      source: undefined,
      questions: [
        { id: "a", prompt: "p", source: { kind: "db", dbPath: "/data/shop.duckdb" } },
      ],
    }));
    expect(set.source).toBeUndefined();
    expect(questionSource(set, set.questions[0])).toEqual({ kind: "db", dbPath: "/data/shop.duckdb" });
  });

  it("keeps a check's fields and trims them", () => {
    const set = parseQuestionSet(minimal({
      questions: [{ id: "a", prompt: "p", check: { sql: "  SELECT 1  ", expect: "one" } }],
    }));
    expect(set.questions[0].check).toEqual({ sql: "SELECT 1", expect: "one" });
    expect(hasCheck(set.questions[0])).toBe(true);
  });

  it.each([
    ["not JSON", "{", /isn't JSON/],
    ["another format", JSON.stringify({ format: "dh-preset" }), /isn't a Duck Harness question set/],
    ["a newer version", minimal({ formatVersion: 2 }), /newer version/],
    ["no id", minimal({ id: "has space" }), /needs an "id"/],
    ["no name", minimal({ name: " " }), /no name/],
    ["no questions", minimal({ questions: [] }), /no questions/],
    ["a bad set source", minimal({ source: { kind: "s3" } }), /source isn't one/],
    ["a question without a prompt", minimal({ questions: [{ id: "a" }] }), /"a" has no prompt/],
    ["duplicate ids", minimal({ questions: [{ id: "a", prompt: "p" }, { id: "a", prompt: "q" }] }), /Two questions/],
    ["no source anywhere", minimal({ source: undefined }), /has no source/],
    ["an empty check", minimal({ questions: [{ id: "a", prompt: "p", check: {} }] }), /needs "sql"/],
    ["a bad TPC-H number", minimal({ questions: [{ id: "a", prompt: "p", check: { tpchQuery: 23 } }] }), /1 to 22/],
    ["bad tags", minimal({ questions: [{ id: "a", prompt: "p", tags: "hard" }] }), /"tags"/],
  ])("refuses %s", (_label, text, message) => {
    expect(() => parseQuestionSet(text)).toThrow(QuestionSetError);
    expect(() => parseQuestionSet(text)).toThrow(message);
  });
});

describe("sources", () => {
  it("parses each kind and refuses the rest", () => {
    expect(parseSource({ kind: "tpch", tpchScale: 1 })).toEqual({ kind: "tpch", tpchScale: 1 });
    expect(parseSource({ kind: "files", files: ["/a.csv"] })).toEqual({ kind: "files", files: ["/a.csv"] });
    expect(parseSource({ kind: "tpch", tpchScale: 0 })).toBeUndefined();
    expect(parseSource({ kind: "files", files: [] })).toBeUndefined();
    expect(parseSource("tpch")).toBeUndefined();
  });

  it("describes them briefly", () => {
    expect(describeSource({ kind: "files", files: ["/x/a.csv", "/x/b.csv"] })).toBe("2 files");
    expect(describeSource({ kind: "files", files: ["/x/a.csv"] })).toBe("a.csv");
  });
});
