import { describe, expect, it } from "vitest";
import { slugify } from "@dh/ui-kit";
import handbook from "../../../../docs/HANDBOOK.md?raw";
import { docForLink } from "../components/HelpView";

describe("the handbook in the app", () => {
  it("has a working link for every entry in its contents", () => {
    const headings = new Set([...handbook.matchAll(/^#{1,4} (.+)$/gm)].map((m) => slugify(m[1])));
    const links = [...handbook.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(15);
    expect(links.filter((l) => !headings.has(l))).toEqual([]);
  });

  it("makes GitHub-style ids", () => {
    expect(slugify("13. A/B and Compare")).toBe("13-ab-and-compare");
    expect(slugify("18. What's remembered, and where")).toBe("18-whats-remembered-and-where");
    expect(slugify("5. SOURCE: the data")).toBe("5-source-the-data");
  });

  it("opens the bundled docs from links, and only those", () => {
    expect(docForLink("QUESTION_SETS.md")).toBe("question-sets");
    expect(docForLink("HANDBOOK.md#4-presets")).toBe("handbook");
    expect(docForLink("../README.md")).toBeNull();
  });
});
