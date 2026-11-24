import { describe, expect, it } from "vitest";
import { cannotInsert, chainProblems, choicesAt, DEFAULT_CHAIN, parseChain, type Instance } from "../chainRules";

const dh1: Instance = { id: "a", type: "dh1" };
const ag: Instance = { id: "b", type: "autograder" };
const eh1: Instance = { id: "c", type: "eh1" };
const es1: Instance = { id: "d", type: "es1" };
const pb1: Instance = { id: "e", type: "pb1" };
const ch1: Instance = { id: "f", type: "ch1" };

describe("chain rules", () => {
  it("offers an instrument first in an empty chain, and nothing that needs runs", () => {
    const fits = choicesAt([], 0).filter((c) => !c.problem).map((c) => c.type);
    expect(fits).toEqual(["dh1", "eh1", "es1", "pb1", "ch1"]);
    expect(cannotInsert([], 0, "autograder")).toContain("needs runs coming in");
  });

  it("puts AUTO GRADER after DH-1, once", () => {
    expect(cannotInsert([dh1], 1, "autograder")).toBeNull();
    expect(cannotInsert([dh1], 0, "autograder")).toContain("needs runs");
    expect(cannotInsert([dh1, ag], 2, "autograder")).toContain("already");
  });

  it("keeps one instrument per chain", () => {
    expect(cannotInsert([dh1], 1, "eh1")).toContain("One instrument per chain");
    expect(cannotInsert([eh1], 0, "dh1")).toContain("One instrument per chain");
  });

  it("doesn't grade EH-1's output: AUTO GRADER needs runs, EH-1 gives grades", () => {
    expect(cannotInsert([eh1], 1, "autograder")).toContain("needs runs");
  });

  it("keeps ES-1 an instrument on its own: nothing takes pipelines yet", () => {
    expect(cannotInsert([], 0, "es1")).toBeNull();
    expect(cannotInsert([dh1], 1, "es1")).toContain("One instrument per chain");
    expect(cannotInsert([es1], 1, "dh1")).toContain("One instrument per chain");
    expect(cannotInsert([es1], 1, "autograder")).toContain("needs runs");
    expect(parseChain([{ id: "d", type: "es1" }])).toEqual([es1]);
  });

  it("keeps PB-1 an instrument on its own: nothing takes events yet", () => {
    expect(cannotInsert([], 0, "pb1")).toBeNull();
    expect(cannotInsert([dh1], 1, "pb1")).toContain("One instrument per chain");
    expect(cannotInsert([pb1], 1, "es1")).toContain("One instrument per chain");
    expect(cannotInsert([pb1], 1, "autograder")).toContain("needs runs");
    expect(parseChain([{ id: "e", type: "pb1" }])).toEqual([pb1]);
  });

  it("keeps CH-1 an instrument on its own: AUTO GRADER after it is for later", () => {
    expect(cannotInsert([], 0, "ch1")).toBeNull();
    expect(cannotInsert([dh1], 1, "ch1")).toContain("One instrument per chain");
    expect(cannotInsert([ch1], 1, "dh1")).toContain("One instrument per chain");
    expect(cannotInsert([ch1], 1, "autograder")).toContain("needs runs");
    expect(parseChain([{ id: "f", type: "ch1" }])).toEqual([ch1]);
  });

  it("finds devices that no longer fit after a delete", () => {
    expect(chainProblems([dh1, ag]).size).toBe(0);
    const problems = chainProblems([ag]); // DH-1 was deleted
    expect(problems.get("b")).toContain("put DH-1 before it");
    expect(chainProblems([dh1, eh1]).get("c")).toContain("One instrument");
  });

  it("cleans a saved chain", () => {
    expect(parseChain([{ id: "x", type: "dh1" }, { id: "y", type: "synth" }, 7])).toEqual([{ id: "x", type: "dh1" }]);
    expect(parseChain(null)).toEqual(DEFAULT_CHAIN);
    expect(parseChain([])).toEqual([]); // you emptied it: it stays empty
  });
});
