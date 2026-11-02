// What the face shows about the current run, built from the server's events.
// A reducer, so the meters, LEDs, and activity strip all read one consistent state.

import type { AgentEvent, AgentResult, Usage } from "./harness";

export type Phase = "idle" | "running" | "stopping" | "done" | "failed";

/** One LED per iteration: off until reached, lit when its API call returns. */
export type LedState = "off" | "calling" | "done" | "error";

export interface ActivityLine {
  iteration: number;
  // "end" closes every run: the answer is ready, the run stopped, or it failed.
  kind: "api" | "tool" | "error" | "thinking" | "edit" | "end";
  /** On the "end" line: whether there is an answer to show. */
  hasAnswer?: boolean;
  text: string;
  detail?: string;
}

export interface RunView {
  phase: Phase;
  startedAt: number | null;
  endedAt: number | null;
  maxIterations: number;
  iteration: number;
  leds: LedState[];
  costUsd: number | null;
  usage: Usage;
  contextTokens: number;
  activity: ActivityLine[];
  result: AgentResult | null;
  error: string | null;
}

export type RunAction =
  | { type: "start"; maxIterations: number; at: number }
  | { type: "event"; event: AgentEvent }
  | { type: "stopping" }
  | { type: "finished"; result: AgentResult; at: number }
  | { type: "failed"; error: string; at: number };

export const ZERO_USAGE: Usage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

export const IDLE: RunView = {
  phase: "idle",
  startedAt: null,
  endedAt: null,
  maxIterations: 25,
  iteration: 0,
  leds: [],
  costUsd: null,
  usage: ZERO_USAGE,
  contextTokens: 0,
  activity: [],
  result: null,
  error: null,
};

/** Prompt tokens across the run: uncached input plus cache reads and writes. */
export function promptTokens(usage: Usage): number {
  return usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
}

/** Share of prompt tokens read from cache, 0..1 (0 before any call). */
export function cacheHitRate(usage: Usage): number {
  const total = promptTokens(usage);
  return total ? usage.cache_read_input_tokens / total : 0;
}

function setLed(leds: LedState[], iteration: number, state: LedState): LedState[] {
  const index = iteration - 1;
  if (index < 0 || index >= leds.length) return leds;
  // An error sticks for the rest of the iteration.
  if (leds[index] === "error" && state === "done") return leds;
  const next = leds.slice();
  next[index] = state;
  return next;
}

const rows = (n: number) => `${n.toLocaleString()} row${n === 1 ? "" : "s"}`;

function sqlOf(input: Record<string, unknown>): string | undefined {
  const sql = input.sql ?? input.query;
  return typeof sql === "string" ? sql : undefined;
}

/** The closing line for a finished run. */
export function endLine(result: AgentResult, iteration: number): ActivityLine {
  const facts = [
    `${result.iterations} iteration${result.iterations === 1 ? "" : "s"}`,
    `${(result.duration_ms / 1000).toFixed(1)} s`,
    ...(result.estimated_cost_usd != null ? [`$${result.estimated_cost_usd.toFixed(4)}`] : []),
  ].join(" · ");
  const hasAnswer = Boolean(result.text);
  let text: string;
  if (result.status === "cancelled") text = "Run stopped · no answer";
  else if (hasAnswer && result.status === "completed") text = "Answer ready";
  else if (hasAnswer) text = `Answer ready · ${result.status.replace(/_/g, " ")}`;
  else text = `Run ended · ${result.status.replace(/_/g, " ")} · no answer`;
  return { iteration, kind: "end", text: `${text} · ${facts}`, detail: result.error ?? undefined, hasAnswer };
}

function applyEvent(view: RunView, event: AgentEvent): RunView {
  const add = (line: ActivityLine) => ({ ...view, activity: [...view.activity, line] });
  switch (event.event) {
    case "run_start":
      return view;
    case "api_call_start":
      return { ...view, iteration: event.iteration, leds: setLed(view.leds, event.iteration, "calling") };
    case "api_call":
      return {
        ...view,
        iteration: event.iteration,
        leds: setLed(view.leds, event.iteration, "done"),
        costUsd: event.total_cost_usd,
        usage: event.total_usage,
        contextTokens: event.context_tokens,
      };
    case "api_error":
      return {
        ...add({ iteration: event.iteration, kind: "error", text: "API error", detail: event.error }),
        leds: setLed(view.leds, event.iteration, "error"),
      };
    case "context_edit":
      return add({ iteration: event.iteration, kind: "edit", text: "Context cleared" });
    case "thinking":
      return add({ iteration: event.iteration, kind: "thinking", text: "Thinking", detail: event.text });
    case "tool_call_start":
      return add({
        iteration: event.iteration,
        kind: "tool",
        text: `${event.label}…`,
        detail: sqlOf(event.input) ?? (typeof event.input.table_name === "string" ? event.input.table_name : undefined),
      });
    case "tool_call": {
      // Replace the matching "…" line with the outcome.
      const activity = view.activity.slice();
      const outcome = event.success
        ? `${event.label} · ${rows(event.row_count ?? 0)}${event.truncated ? " (truncated)" : ""} · ${event.duration_ms} ms`
        : `${event.label} · ${event.error_type ?? "error"}`;
      for (let i = activity.length - 1; i >= 0; i--) {
        if (activity[i].kind === "tool" && activity[i].text === `${event.label}…`) {
          activity[i] = { ...activity[i], kind: event.success ? "tool" : "error", text: outcome };
          break;
        }
      }
      return {
        ...view,
        activity,
        leds: event.success ? view.leds : setLed(view.leds, event.iteration, "error"),
      };
    }
    case "run_end":
      return view;
  }
}

export function runReducer(view: RunView, action: RunAction): RunView {
  switch (action.type) {
    case "start":
      return {
        ...IDLE,
        phase: "running",
        startedAt: action.at,
        maxIterations: action.maxIterations,
        leds: Array<LedState>(action.maxIterations).fill("off"),
      };
    case "event":
      return view.phase === "running" || view.phase === "stopping" ? applyEvent(view, action.event) : view;
    case "stopping":
      return view.phase === "running" ? { ...view, phase: "stopping" } : view;
    case "finished": {
      // A call in flight when the run ended didn't return a usable answer.
      const leds = view.leds.map((led) => (led === "calling" ? "off" : led));
      return {
        ...view,
        phase: "done",
        endedAt: action.at,
        leds,
        activity: [...view.activity, endLine(action.result, Math.max(view.iteration, action.result.iterations))],
        result: action.result,
        costUsd: action.result.estimated_cost_usd,
        usage: action.result.usage ?? view.usage,
      };
    }
    case "failed":
      return {
        ...view,
        phase: "failed",
        endedAt: action.at,
        error: action.error,
        activity: [...view.activity, { iteration: view.iteration, kind: "end", text: "Couldn't run · no answer", detail: action.error, hasAnswer: false }],
      };
  }
}
