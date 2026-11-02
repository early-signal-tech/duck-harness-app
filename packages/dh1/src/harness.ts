// Client for the agent server's JSON Lines protocol (duckdb_agent/serve.py in
// duckdb-analytics-agent). The Rust side starts the server and relays lines: requests go
// out through the `harness_send` command, replies come back as `harness-message` events.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const PROTOCOL_VERSION = 1;

// --- request shapes ---

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** AgentConfig fields. Anything left out uses the server's default. */
export interface AgentConfig {
  model?: string;
  effort?: Effort;
  max_tokens?: number;
  max_iterations?: number;
  max_result_rows?: number;
  max_result_chars?: number;
  max_cell_chars?: number;
  query_timeout_seconds?: number;
  structured_answer?: boolean;
  prompt_caching?: boolean;
  context_editing?: boolean;
  system_prompt?: string | null;
}

/** A DuckDB file or ducklake: URI (opened read-only), or in-memory data from files / TPC-H. */
export type Source =
  | { db: string; schema?: string | null }
  | { load?: string[]; tpch?: number; schema?: string | null };

export interface RunRequest {
  prompt: string;
  source: Source;
  tables?: string[];
  config?: AgentConfig;
  /** Recorded with the run (agent_runs.preset); doesn't change it. */
  preset?: { id?: string; name: string; revision?: number; modified?: boolean };
  /** The caller's own tags, recorded with the run (agent_runs.labels). */
  labels?: Record<string, string | number | boolean | null>;
}

// --- reply shapes ---

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface AgentResult {
  run_id: string;
  status: string; // completed | max_tokens | refusal | ... | cancelled
  text: string;
  iterations: number;
  stop_reason: string | null;
  error: string | null;
  retryable: boolean;
  answer: Record<string, unknown> | null;
  usage: Usage;
  estimated_cost_usd: number | null;
  api_calls: number;
  duration_ms: number;
}

/** Live progress from a run. See EventCallback in duckdb_agent/loop.py for every field. */
export type AgentEvent =
  | { event: "run_start"; run_id: string; model: string; effort: Effort; tables: string[] | null; prompt: string; config: AgentConfig }
  | { event: "api_call_start"; run_id: string; iteration: number }
  | {
      event: "api_call"; run_id: string; iteration: number; latency_ms: number; stop_reason: string | null;
      request_id: string | null; usage: Usage; cost_usd: number | null; context_tokens: number;
      total_usage: Usage; total_cost_usd: number | null;
    }
  | { event: "api_error"; run_id: string; iteration: number; error: string; retryable: boolean }
  | { event: "context_edit"; run_id: string; iteration: number; details: Record<string, unknown> }
  | { event: "thinking"; run_id: string; iteration: number; text: string }
  | { event: "tool_call_start"; run_id: string; iteration: number; tool: string; label: string; tool_use_id: string; input: Record<string, unknown> }
  | {
      event: "tool_call"; run_id: string; iteration: number; tool: string; label: string; tool_use_id: string;
      success: boolean; row_count: number | null; truncated: boolean; error_type: string | null;
      duration_ms: number; result_chars: number; tables: string[];
    }
  | ({ event: "run_end" } & AgentResult);

export interface Hello {
  protocol: number;
  defaults: Required<AgentConfig>;
  effort_levels: Effort[];
  priced_models: string[];
}

type Message =
  | ({ id: string; type: "hello" } & Hello)
  | { id: string; type: "accepted" }
  | ({ id: string; type: "event" } & AgentEvent)
  | { id: string; type: "result"; result: AgentResult }
  | { id: string; type: "ok" }
  | { id: string | null; type: "error"; error: string };

export class HarnessError extends Error {}

/** A run in progress: `done` resolves with the result, or rejects if the run couldn't start. */
export interface Run {
  id: string;
  done: Promise<AgentResult>;
  stop: () => Promise<void>;
}

interface Pending {
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  onEvent?: (event: AgentEvent) => void;
  isFinal: (message: Message) => boolean;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export class Harness {
  private pending = new Map<string, Pending>();
  private unlisten: UnlistenFn[] = [];
  private exited = false;
  /** Messages with no request id (e.g. a line the server couldn't parse). */
  onStrayError: (error: string) => void = (error) => console.warn("agent server:", error);
  /** Called once if the server process goes away. */
  onExit: () => void = () => {};

  static async connect(): Promise<Harness> {
    const harness = new Harness();
    harness.unlisten.push(
      await listen<string>("harness-message", ({ payload }) => harness.receive(payload)),
      await listen("harness-exit", () => harness.serverExited()),
    );
    return harness;
  }

  dispose(): void {
    this.unlisten.forEach((stop) => stop());
    this.unlisten = [];
  }

  /** Protocol version, AgentConfig defaults, effort levels, and priced models. */
  async hello(): Promise<Hello> {
    const reply = await this.request({ type: "hello" }, nextId("hello"));
    if (reply.type !== "hello") throw new HarnessError(`unexpected reply ${reply.type}`);
    if (reply.protocol !== PROTOCOL_VERSION) {
      throw new HarnessError(`agent server speaks protocol ${reply.protocol}; DH-1 needs ${PROTOCOL_VERSION}`);
    }
    const { id: _id, type: _type, ...hello } = reply;
    return hello;
  }

  /** Start a run. Events arrive through `onEvent`; several runs can go at once (A/B). */
  run(request: RunRequest, onEvent?: (event: AgentEvent) => void): Run {
    const id = nextId("run");
    const done = this.request({ type: "run", ...request }, id, {
      onEvent,
      isFinal: (m) => m.type === "result" || m.type === "error",
    }).then((reply) => {
      if (reply.type !== "result") throw new HarnessError(`unexpected reply ${reply.type}`);
      return reply.result;
    });
    return { id, done, stop: () => this.stop(id) };
  }

  /** Cancel a run. Its `done` still resolves, with status "cancelled". */
  async stop(runId: string): Promise<void> {
    await this.request({ type: "stop", run: runId }, nextId("stop"));
  }

  private request(
    body: Record<string, unknown>,
    id: string,
    options: Partial<Pick<Pending, "onEvent" | "isFinal">> = {},
  ): Promise<Message> {
    if (this.exited) return Promise.reject(new HarnessError("the agent server is not running"));
    return new Promise<Message>((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject,
        onEvent: options.onEvent,
        isFinal: options.isFinal ?? (() => true),
      });
      invoke("harness_send", { line: JSON.stringify({ id, ...body }) }).catch((e) => {
        this.pending.delete(id);
        reject(new HarnessError(String(e)));
      });
    });
  }

  private receive(line: string): void {
    let message: Message;
    try {
      message = JSON.parse(line);
    } catch {
      console.warn("agent server sent a line that isn't JSON:", line);
      return;
    }
    const pending = message.id == null ? undefined : this.pending.get(message.id);
    if (!pending) {
      if (message.type === "error") this.onStrayError(message.error);
      return;
    }
    if (message.type === "accepted") return;
    if (message.type === "event") {
      const { id: _id, type: _type, ...event } = message;
      try {
        pending.onEvent?.(event as AgentEvent);
      } catch (e) {
        console.error("event handler failed:", e);
      }
      return;
    }
    if (!pending.isFinal(message)) return;
    this.pending.delete(message.id!);
    if (message.type === "error") pending.reject(new HarnessError(message.error));
    else pending.resolve(message);
  }

  private serverExited(): void {
    if (this.exited) return;
    this.exited = true;
    for (const pending of this.pending.values()) {
      pending.reject(new HarnessError("the agent server stopped"));
    }
    this.pending.clear();
    this.onExit();
  }
}
