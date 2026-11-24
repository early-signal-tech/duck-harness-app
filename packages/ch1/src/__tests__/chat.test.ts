import { IDLE, runReducer, type AgentEvent, type AgentResult, type ConversationTurn } from "@dh/dh1";
import { describe, expect, it } from "vitest";
import { canUse, describeData, queriesIn, sameData, statusNote, structuredOf, turnFromResult, turnFromTrace, when } from "../chat";
import { fakeEngine } from "../fakeEngine";

describe("data rules", () => {
  it("lets the first question use anything, and a follow-up only a database", () => {
    expect(canUse({ tpch: 0.1 }, 0)).toBe(true);
    expect(canUse({ load: ["a.csv"] }, 0)).toBe(true);
    expect(canUse({ tpch: 0.1 }, 1)).toBe(false);
    expect(canUse({ load: ["a.csv"] }, 2)).toBe(false);
    expect(canUse({ db: "/data/shop.duckdb" }, 2)).toBe(true);
    // Staying on the conversation's own data is fine.
    expect(canUse({ tpch: 0.1 }, 1, { tpch: 0.1 })).toBe(true);
  });

  it("compares data the way the engine records it", () => {
    expect(sameData({ db: "/x.duckdb" }, { db: "/x.duckdb", schema: null })).toBe(true);
    expect(sameData({ tpch: 0.1 }, { tpch: 1 })).toBe(false);
    expect(sameData(null, null)).toBe(true);
  });

  it("describes data in a few words", () => {
    expect(describeData({ tpch: 0.1 })).toBe("TPC-H 0.1");
    expect(describeData({ db: "/data/shop.duckdb" })).toBe("shop.duckdb");
    expect(describeData({ db: "s3://bucket/orders/" })).toBe("orders · S3");
    expect(describeData({ load: ["a.csv", "b.csv"] })).toBe("2 files");
    expect(describeData(null)).toBe("unknown data");
  });
});

describe("times", () => {
  const now = new Date(2026, 10, 23, 15, 0);
  it("says now, a time today, yesterday, or a date", () => {
    expect(when(new Date(2026, 10, 23, 14, 59, 30).toISOString(), now)).toBe("now");
    expect(when(new Date(2026, 10, 23, 9, 5).toISOString(), now)).toMatch(/09:05/);
    expect(when(new Date(2026, 10, 22, 23, 0).toISOString(), now)).toBe("yesterday");
    expect(when(new Date(2026, 10, 2, 12, 0).toISOString(), now)).toMatch(/Nov/);
    expect(when(null, now)).toBe("");
  });
});

describe("turns", () => {
  const trace: ConversationTurn = {
    run_id: "r1", parent_run_id: null, prompt: "Top 3?", answer: "Japan", status: "completed", error: null, iterations: 4,
    queries: 3, duration_ms: 900, cost_usd: 0.002, started_at: null, data_source: { tpch: 0.1 },
  };

  it("reads a turn back from the traces, structured answers included", () => {
    expect(turnFromTrace(trace)).toMatchObject({ runId: "r1", answer: "Japan", queries: 3, running: false, structured: null });
    const structured = JSON.stringify({ summary: "Japan leads", key_findings: [], caveats: [], supporting_sql: ["SELECT 1"] });
    expect(structuredOf(structured)?.summary).toBe("Japan leads");
    expect(structuredOf("{not json")).toBeNull();
  });

  it("counts a live run's queries and keeps its activity", () => {
    const tool = (id: string, tool: string): AgentEvent => ({
      event: "tool_call", run_id: "r", iteration: 1, tool, label: id, tool_use_id: id, success: true, row_count: 1,
      truncated: false, error_type: null, duration_ms: 1, result_chars: 1, tables: [],
    });
    let view = runReducer(IDLE, { type: "start", maxIterations: 25, at: 0 });
    for (const e of [tool("a", "query_database"), tool("b", "list_tables"), tool("c", "query_database")]) view = runReducer(view, { type: "event", event: e });
    expect(queriesIn(view)).toBe(2);
    const result = { run_id: "r", status: "completed", text: "done", iterations: 2, estimated_cost_usd: 0.001, duration_ms: 5, error: null, answer: null } as unknown as AgentResult;
    expect(turnFromResult("q", result, view)).toMatchObject({ runId: "r", answer: "done", queries: 2, view });
  });

  it("explains a turn that didn't answer", () => {
    const t = turnFromTrace(trace);
    expect(statusNote(t)).toBeNull();
    expect(statusNote({ ...t, status: "cancelled" })).toMatch(/Stopped/);
    expect(statusNote({ ...t, status: "error", error: "no table" })).toBe("no table");
  });
});

describe("the fake engine", () => {
  it("chains follow-ups into one conversation, newest activity first, and stops at 3", async () => {
    const engine = fakeEngine({ runMs: 5 });
    const labels = { rack_preset: "rack-chat" };
    const first = await engine.run({ prompt: "Top 3?", source: { tpch: 0.1 }, labels }).done;
    const second = await engine.run({ prompt: "And 1996?", source: { tpch: 0.1 }, labels, parent_run_id: first.run_id }).done;
    const { maxTurns, conversations } = await engine.conversations("rack-chat");
    expect(maxTurns).toBe(3);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({ root_run_id: first.run_id, last_run_id: second.run_id, turns: 2, title: "Top 3?" });
    const { turns } = await engine.conversation(second.run_id);
    expect(turns.map((t) => t.prompt)).toEqual(["Top 3?", "And 1996?"]);
    const third = await engine.run({ prompt: "Suppliers?", source: { tpch: 0.1 }, labels, parent_run_id: second.run_id }).done;
    await expect(engine.run({ prompt: "More?", source: { tpch: 0.1 }, labels, parent_run_id: third.run_id }).done).rejects.toThrow(/3 questions/);
    expect((await engine.conversations(null)).conversations).toEqual([]);
  });

  it("cancels a run on stop", async () => {
    const engine = fakeEngine({ runMs: 1000 });
    const run = engine.run({ prompt: "Slow?", source: { tpch: 0.1 } });
    await run.stop();
    expect((await run.done).status).toBe("cancelled");
  });
});
