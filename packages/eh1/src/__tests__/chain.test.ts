import { describe, expect, it } from "vitest";
import { IDLE, onFollowEvent } from "../chain";

const graded = (cost: number | null) => ({
  event: "graded" as const, setlist_run: "sl-1", run_id: "r", question: "Q1", column: "A", repeat: 1,
  correct: 2, careful: 1, efficient: 2, rules_passed: true, judge_error: null, judge_cost_usd: cost,
});

describe("following in a chain", () => {
  it("adds up grades and judge cost across follows", () => {
    let s = onFollowEvent(IDLE, { event: "follow_start", since: null });
    s = onFollowEvent(s, graded(0.002));
    s = onFollowEvent(s, graded(null)); // no judge (no check): free
    s = onFollowEvent({ ...s, active: false }, { event: "follow_start", since: "2026-11-06T10:00:00" });
    s = onFollowEvent(s, graded(0.001));
    expect(s.active).toBe(true);
    expect(s.graded).toBe(3);
    expect(s.judgeCost).toBeCloseTo(0.003);
    expect(s.lastSetlist).toBe("sl-1");
    expect(s.last).toEqual({ question: "Q1", correct: 2, careful: 1, efficient: 2, rulesPassed: true });
  });

  it("says why a setlist wasn't graded", () => {
    const s = onFollowEvent(IDLE, {
      event: "follow_skipped", setlist_run: "sl-9", question_set: "other", revision: 1, reason: "no question set 'other' to grade it with",
    });
    expect(s.problem).toBe("Not graded: no question set 'other' to grade it with.");
  });
});
