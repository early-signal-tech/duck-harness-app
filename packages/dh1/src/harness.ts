// Client for the agent server's JSON Lines protocol (duckdb_agent/serve.py in
// duckdb-analytics-agent). The host starts the server and relays lines through an
// EngineTransport (the engine named "dh1"): requests go out with `send`, replies come
// back through `onMessage`.

import type { EngineTransport } from "@dh/ui-kit";

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
  context_trigger_tokens?: number;
  context_keep_tool_uses?: number;
  context_clear_at_least_tokens?: number;
  context_protected_tools?: string[];
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
  /** Added with the compressor settings; absent from older servers. */
  limits?: { max_tokens: number };
  tools?: string[];
}

/** Where traces go, and whether the background traces server is up. */
export interface TracesInfo {
  enabled: boolean;
  db: string | null;
  exists: boolean;
  size_bytes: number | null;
  server: { running: boolean; uri: string | null; pid: number | null } | null;
}

type Message =
  | ({ id: string; type: "hello" } & Hello)
  | ({ id: string; type: "traces" } & TracesInfo)
  | { id: string; type: "accepted" }
  | ({ id: string; type: "event" } & AgentEvent)
  | { id: string; type: "result"; result: AgentResult }
  | { id: string; type: "ok"; stopped?: boolean; deleted?: boolean }
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
  private unlisten: (() => void)[] = [];
  private exited = false;
  /** Which start of the server this client belongs to (see EngineTransport.restart). */
  private generation = 0;
  /** Messages with no request id (e.g. a line the server couldn't parse). */
  onStrayError: (error: string) => void = (error) => console.warn("agent server:", error);
  /** Called once if the server process goes away. */
  onExit: () => void = () => {};

  private constructor(private transport: EngineTransport) {}

  static async connect(transport: EngineTransport): Promise<Harness> {
    const harness = new Harness(transport);
    harness.unlisten.push(
      await transport.onMessage((line) => harness.receive(line)),
      // A restarted server's predecessor also reports its exit: only ours counts.
      await transport.onExit((generation) => {
        if (generation === harness.generation) harness.serverExited();
      }),
    );
    harness.generation = await transport.generation();
    return harness;
  }

  /** Stop listening. Anything still waiting (a run, after an engine restart) fails. */
  dispose(): void {
    this.unlisten.forEach((stop) => stop());
    this.unlisten = [];
    for (const pending of this.pending.values()) pending.reject(new HarnessError("the engine was restarted"));
    this.pending.clear();
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

  /** Where traces go and whether the traces server is running. */
  async traces(): Promise<TracesInfo> {
    const reply = await this.request({ type: "traces" }, nextId("traces"));
    if (reply.type !== "traces") throw new HarnessError(`unexpected reply ${reply.type}`);
    const { id: _id, type: _type, ...info } = reply;
    return info;
  }

  /** Stop the background traces server (the next run starts it again). */
  async tracesStop(): Promise<boolean> {
    const reply = await this.request({ type: "traces_stop" }, nextId("traces"));
    return reply.type === "ok" && !!reply.stopped;
  }

  /** Delete the traces database. Refused while runs are going. */
  async tracesReset(): Promise<boolean> {
    const reply = await this.request({ type: "traces_reset" }, nextId("traces"));
    return reply.type === "ok" && !!reply.deleted;
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
      this.transport.send(JSON.stringify({ id, ...body })).catch((e) => {
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
