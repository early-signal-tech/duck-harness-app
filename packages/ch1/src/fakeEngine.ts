// A stand-in for DH-1's engine, for headless checks and tests: conversations kept in
// memory, and runs that step through a couple of queries before answering. The answers
// are canned and say so; nothing touches a database.

import type { AgentEvent, AgentResult, ConversationSummary, ConversationTurn, RunRequest, Source } from "@dh/dh1";
import type { ChatEngine } from "./engine";

const MAX_TURNS = 3;

interface FakeRun extends ConversationTurn {
  rackPreset: string | null;
  ended_at: string;
}

const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

export interface FakeOptions {
  /** Start with a few example conversations. */
  seed?: boolean;
  /** How long a run takes, in ms (default 1600). */
  runMs?: number;
}

export function fakeEngine({ seed = false, runMs = 1600 }: FakeOptions = {}): ChatEngine & { runs: FakeRun[] } {
  const runs: FakeRun[] = [];
  let n = 0;
  const add = (prompt: string, answer: string, source: Source, parent: string | null, minutesAgo: number, rackPreset: string | null, cost = 0.0012): FakeRun => {
    const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const run: FakeRun = {
      run_id: `fake-${++n}`, parent_run_id: parent, prompt, answer, status: "completed", error: null, iterations: 3,
      queries: 2, duration_ms: 4200, cost_usd: cost, started_at: at, ended_at: at, data_source: source, rackPreset,
    };
    runs.push(run);
    return run;
  };
  if (seed) {
    const tpch = { tpch: 0.1 };
    const r1 = add("Which 3 nations had the most revenue in 1995?", "| nation | revenue_1995 |\n|---|---|\n| JAPAN | $11.2M |\n| CHINA | $10.9M |\n| GERMANY | $10.7M |\n\n*Example answer from the fake engine.*", tpch, null, 240, null, 0.0019);
    add("How did those three do in 1996?", "All three grew; China grew most (+6.1%) and passed Japan.\n\n*Example answer from the fake engine.*", tpch, r1.run_id, 236, null, 0.0009);
    add("Which 5 customers spent the most in 1997?", "Customer#000143500 leads with $7.0M.\n\n*Example answer from the fake engine.*", tpch, null, 60 * 26, null);
  }

  const chainOf = (runId: string): FakeRun[] => {
    const chain: FakeRun[] = [];
    let at: FakeRun | undefined = runs.find((r) => r.run_id === runId);
    while (at) {
      chain.unshift(at);
      const parent: string | null = at.parent_run_id;
      at = parent ? runs.find((r) => r.run_id === parent) : undefined;
    }
    return chain;
  };
  const rootOf = (run: FakeRun) => chainOf(run.run_id)[0];

  return {
    runs,
    async conversations(rackPreset) {
      const roots = runs.filter((r) => !r.parent_run_id && r.rackPreset === rackPreset);
      const conversations: ConversationSummary[] = roots.map((root) => {
        const mine = runs.filter((r) => rootOf(r).run_id === root.run_id);
        const last = mine.reduce((a, b) => (b.ended_at > a.ended_at ? b : a));
        return {
          root_run_id: root.run_id, last_run_id: last.run_id, turns: mine.length, title: root.prompt,
          started_at: root.started_at, ended_at: last.ended_at, cost_usd: mine.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
          last_status: last.status, data_source: last.data_source,
        };
      });
      conversations.sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""));
      return { maxTurns: MAX_TURNS, conversations };
    },
    async conversation(runId) {
      return { maxTurns: MAX_TURNS, turns: chainOf(runId).map(({ rackPreset: _p, ended_at: _e, ...turn }) => turn) };
    },
    run(request: RunRequest, onEvent?: (event: AgentEvent) => void) {
      const id = `req-${++n}`;
      const runId = `fake-${++n}`;
      let stopped = false;
      let finish: (() => void) | null = null;
      const parent = request.parent_run_id ? runs.find((r) => r.run_id === request.parent_run_id) : undefined;
      const done = new Promise<AgentResult>((resolve, reject) => {
        if (request.parent_run_id && !parent) return reject(new Error(`no finished run ${request.parent_run_id} to follow up on`));
        if (parent && chainOf(parent.run_id).length >= MAX_TURNS) return reject(new Error(`this conversation already has ${MAX_TURNS} questions`));
        const emit = (event: AgentEvent) => { if (!stopped) onEvent?.(event); };
        const config = request.config ?? {};
        emit({ event: "run_start", run_id: runId, model: config.model ?? "claude-sonnet-5-5", effort: config.effort ?? "medium", tables: null, prompt: request.prompt, config });
        const steps: [number, () => void][] = [
          [0.1, () => emit({ event: "api_call_start", run_id: runId, iteration: 1 })],
          [0.3, () => emit({ event: "tool_call_start", run_id: runId, iteration: 1, tool: "query_database", label: "revenue by nation", tool_use_id: "t1", input: {} })],
          [0.5, () => emit({ event: "tool_call", run_id: runId, iteration: 1, tool: "query_database", label: "revenue by nation", tool_use_id: "t1", success: true, row_count: 25, truncated: false, error_type: null, duration_ms: 40, result_chars: 900, tables: ["main.orders"] })],
          [0.6, () => emit({ event: "tool_call_start", run_id: runId, iteration: 2, tool: "query_database", label: "top 5 by growth", tool_use_id: "t2", input: {} })],
          [0.8, () => emit({ event: "tool_call", run_id: runId, iteration: 2, tool: "query_database", label: "top 5 by growth", tool_use_id: "t2", success: true, row_count: 5, truncated: false, error_type: null, duration_ms: 30, result_chars: 300, tables: ["main.supplier"] })],
        ];
        const timers = steps.map(([at, step]) => setTimeout(step, at * runMs));
        const end = (status: string) => {
          timers.forEach(clearTimeout);
          const answer = status === "completed"
            ? `**${request.prompt}**\n\n| rank | name | value |\n|---|---|---|\n| 1 | Example A | 412 |\n| 2 | Example B | 377 |\n\n*Example answer from the fake engine.*`
            : "";
          const result: AgentResult = {
            run_id: runId, status, text: answer, iterations: 2, stop_reason: status === "completed" ? "end_turn" : null, error: null,
            retryable: false, answer: null, usage: ZERO, estimated_cost_usd: 0.0011, api_calls: 2, duration_ms: runMs,
          };
          const at = new Date().toISOString();
          runs.push({
            run_id: runId, parent_run_id: request.parent_run_id ?? null, prompt: request.prompt, answer: answer || null, status,
            error: null, iterations: 2, queries: 2, duration_ms: runMs, cost_usd: 0.0011, started_at: at, ended_at: at,
            data_source: request.source, rackPreset: (request.labels?.rack_preset as string | undefined) ?? null,
          });
          onEvent?.({ event: "run_end", ...result });
          resolve(result);
        };
        finish = () => end("cancelled");
        timers.push(setTimeout(() => end("completed"), runMs));
      });
      return {
        id,
        done,
        stop: async () => {
          if (stopped) return;
          stopped = true;
          finish?.();
        },
      };
    },
  };
}
