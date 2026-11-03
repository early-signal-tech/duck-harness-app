import { describe, expect, it } from "vitest";
import type { QuestionSet } from "@dh/formats";
import type { SetlistInfo, SetlistPreset } from "../engine";
import {
  differs, gradeStatus, groupSetlists, matchesSearch, nameToStore, passesFilter, presetNames, runStatus, setlistTitle, suggestedTitle,
} from "../picker";

const set: QuestionSet = {
  id: "tpch", name: "TPC-H", description: "", revision: 2, savedAt: "", categories: [],
  source: { kind: "tpch", tpchScale: 0.01 },
  questions: Array.from({ length: 22 }, (_, i) => ({ id: `Q${i + 1}`, title: "", prompt: "p", tags: [] })),
};

const preset = (column: string, name: string, config: Record<string, unknown>, modified = false): SetlistPreset => ({ column, name, modified, config });
const base = { model: "claude-haiku-5-5", effort: "low", max_iterations: 10, system_prompt: "sha256:aaa" };

const setlist = (over: Partial<SetlistInfo> = {}): SetlistInfo => ({
  id: "sl-2026-11-02-1707-g495", question_set: "tpch", revision: 2, name: null, note: null, concurrency: 4,
  runs: 44, completed: 44, cancelled: 0, columns: 2, repeats: 1, cost_usd: 0.4,
  started_at: "2026-11-02T17:07:00", ended_at: "2026-11-02T17:30:00",
  presets: [preset("A", "Quick & Cheap", base), preset("B", "Balanced", { ...base, effort: "medium" })],
  grading: { graded: 0, total: null, other_settings: 0 }, ...over,
});

describe("the setlist picker", () => {
  it("titles a setlist by its name, else its facts, and stores only your words", () => {
    const s = setlist();
    expect(suggestedTitle(s, "TPC-H")).toBe("TPC-H · 2 presets × 1 · Nov 2, 17:07");
    expect(setlistTitle(setlist({ name: "Compressor test" }), "TPC-H")).toBe("Compressor test");
    expect(nameToStore("TPC-H · 2 presets × 1 · Nov 2, 17:07", s, "TPC-H")).toBeNull();
    expect(nameToStore("TPC-H · 2 presets × 1 · Nov 2, 17:07  - after the fix ", s, "TPC-H")).toBe("TPC-H · 2 presets × 1 · Nov 2, 17:07 - after the fix");
    expect(nameToStore("   ", s, "TPC-H")).toBeNull();
  });

  it("says how far it ran: complete, running, or stopped", () => {
    const later = new Date("2026-11-02T18:00:00").getTime();
    expect(runStatus(setlist(), set, later)).toEqual({ kind: "complete", label: "COMPLETE" });
    expect(runStatus(setlist({ runs: 39, cancelled: 3 }), set, later)).toEqual({ kind: "stopped", label: "STOPPED 36/44" });
    expect(runStatus(setlist({ runs: 20 }), set, new Date("2026-11-02T17:31:00").getTime()).label).toBe("RUNNING 20/44");
    expect(runStatus(setlist({ runs: 20 }), set, later).label).toBe("STOPPED 20/44");
    // Without the set the plan is unknown: only cancelled runs say it stopped.
    expect(runStatus(setlist({ runs: 20 }), null, later).kind).toBe("complete");
  });

  it("says how much is graded with these settings", () => {
    expect(gradeStatus(setlist())?.label).toBe("NOT GRADED");
    expect(gradeStatus(setlist({ grading: { graded: 0, total: null, other_settings: 2 } }))?.kind).toBe("other");
    expect(gradeStatus(setlist({ grading: { graded: 10, total: 4, other_settings: 0 } }))?.label).toBe("GRADED 10/44");
    expect(gradeStatus(setlist({ grading: { graded: 44, total: 5.23, other_settings: 1 } }))?.label).toBe("GRADED · AVG 5.2/6");
    expect(gradeStatus(setlist({ grading: undefined }))).toBeNull();
  });

  it("filters by grade", () => {
    const none = setlist();
    const some = setlist({ grading: { graded: 3, total: 4, other_settings: 0 } });
    expect([passesFilter(none, "graded"), passesFilter(none, "not-graded"), passesFilter(none, "all")]).toEqual([false, true, true]);
    expect([passesFilter(some, "graded"), passesFilter(some, "not-graded")]).toEqual([true, false]);
  });

  it("names what differed between the presets", () => {
    expect(differs(setlist().presets!).short).toBe("effort low / medium");
    const three = [preset("A", "Q", base), preset("B", "B", { ...base, effort: "medium", max_iterations: 25 }), preset("C", "D", { ...base, model: "claude-opus-5-5" })];
    const d = differs(three);
    expect(d.short).toBe("effort, iterations, model");
    expect(d.full).toContain("model: haiku-5-5 / haiku-5-5 / opus-5-5");
    expect(differs([preset("A", "Q", base), preset("B", "Q", { ...base, system_prompt: "sha256:bbb" })]).short).toBe("system prompt");
    expect(differs([preset("A", "Q", base), preset("B", "Q", base)]).short).toBe("same settings");
    expect(differs([preset("A", "Q", base)]).short).toBe("one preset");
    expect(presetNames([preset("A", "Balanced", base, true)])).toBe("Balanced (edited)");
  });

  it("searches every word across title, note, ID, set, presets, and date", () => {
    const s = setlist({ name: "Compressor test", note: "Threshold 60K" });
    expect(matchesSearch(s, "compressor 60k", "TPC-H")).toBe(true);
    expect(matchesSearch(s, "balanced nov 2", "TPC-H")).toBe(true);
    expect(matchesSearch(s, "g495", "TPC-H")).toBe(true);
    expect(matchesSearch(s, "opus", "TPC-H")).toBe(false);
  });

  it("groups by question set with the newest of each set LATEST, even when filtered out", () => {
    const list = [
      setlist({ id: "new-tpch" }),
      setlist({ id: "new-eval", question_set: "eval" }),
      setlist({ id: "old-tpch", grading: { graded: 1, total: 6, other_settings: 0 } }),
    ];
    const groups = groupSetlists(list, (s) => passesFilter(s, "graded"), (id) => (id === "tpch" ? set : null));
    expect(groups.map((g) => [g.questionSet, g.latest, g.setlists.map((s) => s.id)])).toEqual([["tpch", "new-tpch", ["old-tpch"]]]);
    expect(groups[0].set?.name).toBe("TPC-H");
  });
});
