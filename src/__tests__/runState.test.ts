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
