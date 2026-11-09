// Client for ES-1's engine (cli-bridge's es1-serve), JSON Lines like the other devices. A
// request is a verb from the bridge's table: it answers `accepted`, then any `event`s, then
// one `result`. A request it refuses gets `error` instead. See cli-bridge's README.

import type { EngineTransport } from "@dh/ui-kit";

export const PROTOCOL_VERSION = 1;

export interface ToolReport {
  name: string;
  path: string | null;
  version: string | null;
  tested: string[];
  status: "tested" | "untested" | "missing";
  /** Why it might not work, in a sentence, when it's untested or missing. */
  warning: string | null;
}

export interface Hello {
  protocol: number;
  version: string;
  device: string;
  tool: ToolReport;
}

/** What a finished `once` verb returns. */
export interface OnceResult<Row> {
  rows: Row[];
  count: number;
  truncated: boolean;
  bad_lines: number;
  /** Where the raw output was saved. */
  snapshot: string | null;
}

/** `code` is the bridge's: not_logged_in, tool_missing, bad_request, and so on. */
export class EngineError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

type Message =
  | ({ id: string; type: "hello" } & Hello)
  | { id: string; type: "accepted" }
  | { id: string; type: "event"; event: string }
  | { id: string; type: "result"; result: { ok: boolean; error?: string; code?: string } & Record<string, unknown> }
  | { id: string | null; type: "error"; error: string; code?: string };

interface Pending {
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export class Engine {
  private pending = new Map<string, Pending>();
  private unlisten: (() => void)[] = [];
  private exited = false;
  private generation = 0;
  onExit: () => void = () => {};

  private constructor(private transport: EngineTransport) {}

  static async connect(transport: EngineTransport): Promise<Engine> {
    const engine = new Engine(transport);
    engine.unlisten.push(
      await transport.onMessage((line) => engine.receive(line)),
      await transport.onExit((generation) => {
        if (generation === engine.generation) engine.serverExited();
      }),
    );
    engine.generation = await transport.generation();
    return engine;
  }

  /** Stop listening; anything still waiting fails. */
  dispose(): void {
    this.unlisten.forEach((stop) => stop());
    this.unlisten = [];
    for (const pending of this.pending.values()) pending.reject(new EngineError("the engine was restarted"));
    this.pending.clear();
  }

  async hello(): Promise<Hello> {
    const reply = await this.request({ type: "hello" }, nextId("hello"));
    if (reply.type !== "hello") throw new EngineError(`unexpected reply ${reply.type}`);
    if (reply.protocol !== PROTOCOL_VERSION) {
      throw new EngineError(`the bridge speaks protocol ${reply.protocol}; ES-1 needs ${PROTOCOL_VERSION}`);
    }
    return reply;
  }

  /** Run a `once` verb to its end. A failed command rejects, with the bridge's code. */
  async once<Row>(verb: string, args: Record<string, unknown>, profile: string): Promise<OnceResult<Row>> {
    const reply = await this.request({ type: verb, args, profile }, nextId(verb));
    if (reply.type !== "result") throw new EngineError(`unexpected reply ${reply.type}`);
    if (!reply.result.ok) throw new EngineError(reply.result.error ?? `${verb} failed`, reply.result.code);
    return reply.result as unknown as OnceResult<Row>;
  }

  private request(body: Record<string, unknown>, id: string): Promise<Message> {
    if (this.exited) return Promise.reject(new EngineError("the flowctl bridge is not running"));
    return new Promise<Message>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.send(JSON.stringify({ id, ...body })).catch((e) => {
        this.pending.delete(id);
        reject(new EngineError(String(e)));
      });
    });
  }

  private receive(line: string): void {
    let message: Message;
    try {
      message = JSON.parse(line);
    } catch {
      console.warn("the bridge sent a line that isn't JSON");
      return;
    }
    const pending = message.id == null ? undefined : this.pending.get(message.id);
    if (!pending) {
      if (message.type === "error") console.warn("bridge:", message.error);
      return;
    }
    if (message.type === "accepted" || message.type === "event") return;
    this.pending.delete(message.id!);
    if (message.type === "error") pending.reject(new EngineError(message.error, message.code));
    else pending.resolve(message);
  }

  private serverExited(): void {
    if (this.exited) return;
    this.exited = true;
    for (const pending of this.pending.values()) pending.reject(new EngineError("the flowctl bridge stopped"));
    this.pending.clear();
    this.onExit();
  }
}
