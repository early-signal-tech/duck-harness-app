import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentResult, Usage } from "../harness";
import { cacheHitRate, IDLE, runReducer, type RunAction, type RunView } from "../runState";

const usage = (input = 0, output = 0, read = 0, write = 0): Usage => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
});

const ev = (event: Record<string, unknown>): RunAction => ({ type: "event", event: { run_id: "r", ...event } as AgentEvent });

function play(...actions: RunAction[]): RunView {
  return actions.reduce(runReducer, runReducer(IDLE, { type: "start", maxIterations: 5, at: 1000 }));
}

const result = (patch: Partial<AgentResult> = {}): AgentResult => ({
  run_id: "r", status: "completed", text: "done", iterations: 2, stop_reason: "end_turn", error: null,
  retryable: false, answer: null, usage: usage(500, 50, 1000), estimated_cost_usd: 0.002, api_calls: 2,
  duration_ms: 1200, ...patch,
});

describe("runReducer", () => {
  it("starts with one LED per allowed iteration", () => {
    const view = play();
    expect(view.phase).toBe("running");
    expect(view.leds).toEqual(["off", "off", "off", "off", "off"]);
  });

  it("lights an LED while Claude is called and when the call returns", () => {
    let view = play(ev({ event: "api_call_start", iteration: 1 }));
    expect(view.leds[0]).toBe("calling");
    view = runReducer(view, ev({
      event: "api_call", iteration: 1, context_tokens: 4200, total_cost_usd: 0.0011, total_usage: usage(200, 30, 4000),
    }));
    expect(view.leds[0]).toBe("done");
    expect(view.iteration).toBe(1);
    expect(view.costUsd).toBe(0.0011);
    expect(view.contextTokens).toBe(4200);
  });

  it("replaces a tool's pending line with its outcome and marks a failed iteration", () => {
    const view = play(
      ev({ event: "api_call_start", iteration: 2 }),
      ev({ event: "tool_call_start", iteration: 2, label: "Query Database", input: { sql: "SELECT 1" } }),
      ev({ event: "tool_call", iteration: 2, label: "Query Database", success: false, error_type: "timeout", duration_ms: 30000 }),
      ev({ event: "api_call", iteration: 2, context_tokens: 1, total_cost_usd: 0, total_usage: usage() }),
    );
    expect(view.activity).toEqual([
      { iteration: 2, kind: "error", text: "Query Database · timeout", detail: "SELECT 1" },
    ]);
    expect(view.leds[1]).toBe("error"); // the later api_call doesn't overwrite it
  });

  it("ignores events after the run has ended", () => {
    const done = runReducer(play(), { type: "finished", result: result(), at: 2000 });
    expect(runReducer(done, ev({ event: "api_call_start", iteration: 3 }))).toBe(done);
  });

  it("takes final cost and usage from the result and clears an in-flight LED", () => {
    const view = runReducer(
      play(ev({ event: "api_call_start", iteration: 1 })),
      { type: "finished", result: result({ status: "cancelled", estimated_cost_usd: 0.0005 }), at: 3000 },
    );
    expect(view.phase).toBe("done");
    expect(view.leds[0]).toBe("off");
    expect(view.costUsd).toBe(0.0005);
    expect(view.endedAt).toBe(3000);
  });

  it("records a run that could not start", () => {
    const view = runReducer(play(), { type: "failed", error: "FileNotFoundError: x.csv", at: 1500 });
    expect(view.phase).toBe("failed");
    expect(view.error).toContain("x.csv");
  });
});

describe("cacheHitRate", () => {
  it("is the share of prompt tokens read from cache", () => {
    expect(cacheHitRate(usage(100, 999, 300, 100))).toBe(0.6);
    expect(cacheHitRate(usage())).toBe(0);
  });
});

const last = <T,>(items: T[]): T | undefined => items[items.length - 1];

describe("the closing activity line", () => {
  it("says the answer is ready, with the run's numbers", () => {
    const view = runReducer(play(ev({ event: "api_call_start", iteration: 2 })), { type: "finished", result: result(), at: 2000 });
    expect(last(view.activity)).toEqual({
      iteration: 2, kind: "end", text: "Answer ready · 2 iterations · 1.2 s · $0.0020", detail: undefined, hasAnswer: true,
    });
  });

  it("says when a run was stopped or ended without an answer", () => {
    const stopped = runReducer(play(), { type: "finished", result: result({ status: "cancelled", text: "" }), at: 2000 });
    expect(last(stopped.activity)).toMatchObject({ text: expect.stringMatching(/^Run stopped · no answer/), hasAnswer: false });
    const failed = runReducer(play(), { type: "finished", result: result({ status: "api_error", text: "", error: "overloaded" }), at: 2000 });
    expect(last(failed.activity)).toMatchObject({ text: expect.stringMatching(/^Run ended · api error · no answer/), detail: "overloaded" });
  });

  it("notes an answer that came from a limit, like the iteration cap", () => {
    const view = runReducer(play(), { type: "finished", result: result({ status: "max_iterations", text: "best effort" }), at: 2000 });
    expect(last(view.activity)?.text).toMatch(/^Answer ready · max iterations/);
  });

  it("closes a run that couldn't start", () => {
    const view = runReducer(play(), { type: "failed", error: "FileNotFoundError: x.csv", at: 1500 });
    expect(last(view.activity)).toMatchObject({ kind: "end", text: "Couldn't run · no answer", hasAnswer: false });
  });
});

describe("tool lines", () => {
  it("says 1 row, not 1 rows", () => {
    const view = play(
      ev({ event: "tool_call_start", iteration: 1, label: "Query Database", input: { sql: "SELECT 1" } }),
      ev({ event: "tool_call", iteration: 1, label: "Query Database", success: true, row_count: 1, truncated: false, duration_ms: 3 }),
    );
    expect(view.activity[0].text).toBe("Query Database · 1 row · 3 ms");
  });
});

describe("the compressor's readings", () => {
  it("records each clear and the peak prompt size", () => {
    const view = play(
      ev({ event: "api_call", iteration: 1, context_tokens: 70_000, total_cost_usd: 0, total_usage: usage() }),
      ev({ event: "api_call", iteration: 2, context_tokens: 91_000, total_cost_usd: 0, total_usage: usage() }),
      ev({ event: "context_edit", iteration: 3, details: { cleared_input_tokens: 24_000, cleared_tool_uses: 5 } }),
      ev({ event: "api_call", iteration: 3, context_tokens: 66_000, total_cost_usd: 0, total_usage: usage() }),
    );
    expect(view.clears).toEqual([{ iteration: 3, tokens: 24_000, toolUses: 5 }]);
    expect(view.peakContextTokens).toBe(91_000);
    expect(view.contextTokens).toBe(66_000);
    expect(last(view.activity)?.text).toBe("Context cleared · −24.0K tokens · 5 tool results");
  });
});

it("says 1 tool result, not 1 tool results", () => {
  const view = play(ev({ event: "context_edit", iteration: 2, details: { cleared_input_tokens: 611, cleared_tool_uses: 1 } }));
  expect(last(view.activity)?.text).toBe("Context cleared · −0.6K tokens · 1 tool result");
});
