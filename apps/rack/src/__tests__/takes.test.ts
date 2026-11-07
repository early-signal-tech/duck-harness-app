import { describe, expect, it } from "vitest";
import { setlistGrid, stepTake, takeFacts, takeNumber, takeTitle } from "../takes";

const take = (over = {}) => ({
  key: "k", kind: "run" as const, started_at: "2026-11-06T14:05:00", ended_at: null, runs: 1, completed: 1, cost_usd: 0.0123,
  prompt: "Top 5?", setlist_name: null, question_set: null, ...over,
});

describe("takes", () => {
  it("titles a take by its prompt, or a setlist by its name", () => {
    expect(takeTitle(take())).toBe("Top 5?");
    expect(takeTitle(take({ kind: "setlist", prompt: null, setlist_name: "Nightly" }))).toBe("Nightly");
    expect(takeTitle(take({ kind: "setlist", prompt: null, question_set: "tpch" }))).toBe("tpch setlist");
  });

  it("says how a take went", () => {
    expect(takeFacts(take({ kind: "ab", runs: 2, completed: 1 }), new Date("2026-11-06T18:00:00"))).toMatch(/1\/2 completed · \$0\.0123$/);
  });

  it("numbers takes oldest first, with a playing take as the next one", () => {
    expect(takeNumber(null, 12, false)).toEqual({ n: 12, of: 12 });
    expect(takeNumber(null, 12, true)).toEqual({ n: 13, of: 13 });
    expect(takeNumber(0, 12, false)).toEqual({ n: 12, of: 12 });
    expect(takeNumber(11, 12, false)).toEqual({ n: 1, of: 12 });
  });

  it("steps older and newer, stopping at the ends", () => {
    // Nothing playing: the newest is takes[0].
    expect(stepTake(null, 3, -1)).toBe(1);
    expect(stepTake(1, 3, -1)).toBe(2);
    expect(stepTake(2, 3, -1)).toBe(2); // the oldest stays
    expect(stepTake(2, 3, 1)).toBe(1);
    expect(stepTake(1, 3, 1)).toBeNull(); // back to the newest
    // Something playing: it's the newest, ahead of takes[0].
    expect(stepTake(null, 3, -1, true)).toBe(0);
    expect(stepTake(0, 3, 1, true)).toBeNull();
    expect(stepTake(null, 0, -1)).toBeNull();
  });

  it("lays a setlist out as questions × columns", () => {
    const run = (q: string, c: string, r: number) => ({ run_id: `${q}${c}${r}`, prompt: "", answer: null, status: "completed",
      error: null, iterations: 1, duration_ms: 1, cost_usd: 0, labels: { question: q, column: c, repeat: r } });
    const grid = setlistGrid([run("q1", "B", 1), run("q1", "A", 1), run("q2", "A", 1), run("q1", "A", 2)]);
    expect(grid.questions).toEqual(["q1", "q2"]);
    expect(grid.columns).toEqual(["A", "B"]);
    expect(grid.cell("q1", "A").map((r) => r.run_id)).toEqual(["q1A1", "q1A2"]);
  });
});
