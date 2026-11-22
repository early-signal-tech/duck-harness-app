// PB-1's real engine: cli-bridge's pb1-serve, over the same JSON Lines protocol as ES-1's
// bridge (cli-bridge's README). A request names a verb from the bridge's Parkbench table; it
// answers `accepted`, then any `event`s, then one `result`, or `error` if it refuses.
//
// The panel speaks Parkbench's flags (settings.ts); the table names each flag's argument in
// snake case. ARGS below is the table's list, so a flag it doesn't take fails here, by name,
// instead of reaching the bridge. Reset and the secrets go through the host's confirmation.

import type { EngineTransport, SecretInfo, SecretRequest } from "@dh/ui-kit";
import { Pb1Error, type Pb1Engine, type Running } from "./engine";
import type { DoneEvent, RunEvent } from "./events";
import { SECRET_TYPES } from "./secretTypes";
import type { Flags } from "./settings";

export const PROTOCOL_VERSION = 1;

const CONNECTION = ["metadata_store", "ducklake_secret", "data_sink", "migrate"];

/** The arguments each verb takes, as cli-bridge's tools/parkbench/table.json lists them. */
export const ARGS: Record<string, readonly string[]> = {
  setup: CONNECTION,
  reset: ["metadata_store", "ducklake_secret", "migrate"],
  run: [
    ...CONNECTION, "run_mode", "mode", "payload_type", "num_users", "ml_labels", "conversion_rate", "flush_interval",
    "batch_size", "batch_size_min", "batch_size_max", "num_batches", "distribution", "hotspot_days", "partition_by",
    "tick_interval", "duration", "duplicate_rate", "schema_drift_rate",
  ],
};

/** Parkbench's flags as the table's arguments: snake case, and every value a string. */
export function argsFor(verb: keyof typeof ARGS, flags: Flags): Record<string, string> {
  const args: Record<string, string> = {};
  for (const [flag, value] of Object.entries(flags)) {
    const name = flag.replace(/-/g, "_");
    if (!ARGS[verb].includes(name)) throw new Pb1Error(`PB-1 can't send --${flag} to ${verb}: the engine doesn't take it`, "bad_request");
    args[name] = String(value);
  }
  return args;
}

export interface Hello {
  protocol: number;
  version: string;
  device: string;
  tool: { name: string; path: string | null; version: string | null; status: "tested" | "untested" | "missing"; warning: string | null };
  verbs: Record<string, unknown>;
}

type Result = { ok: boolean; error?: string; code?: string; stopped?: boolean } & Record<string, unknown>;
type Message =
  | ({ id: string; type: "hello" } & Hello)
  | { id: string; type: "accepted" }
  | { id: string; type: "ok" }
  | { id: string; type: "event"; event: string; line?: RunEvent; text?: string }
  | { id: string; type: "result"; result: Result }
  | { id: string | null; type: "error"; error: string; code?: string };

interface Pending {
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  onEvent?: (message: Extract<Message, { type: "event" }>) => void;
}

/** A tool's error, first line only: Parkbench prints its usage after it. */
const firstLine = (text: string | undefined, fallback: string) => (text?.split("\n").find((l) => l.trim()) ?? fallback).replace(/^Error:\s*/, "");

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export class Bridge implements Pb1Engine {
  private pending = new Map<string, Pending>();
  private unlisten: (() => void)[] = [];
  private exited = false;
  private generation = 0;
  onExit: () => void = () => {};

  private constructor(private transport: EngineTransport) {}

  static async connect(transport: EngineTransport): Promise<Bridge> {
    const bridge = new Bridge(transport);
    bridge.unlisten.push(
      await transport.onMessage((line) => bridge.receive(line)),
      await transport.onExit((generation) => {
        if (generation === bridge.generation) bridge.serverExited();
      }),
    );
    bridge.generation = await transport.generation();
    return bridge;
  }

  dispose(): void {
    this.unlisten.forEach((stop) => stop());
    this.unlisten = [];
    for (const pending of this.pending.values()) pending.reject(new Pb1Error("the engine was restarted"));
    this.pending.clear();
  }

  async hello(): Promise<Hello> {
    const reply = await this.request({ type: "hello" }, nextId("hello"));
    if (reply.type !== "hello") throw new Pb1Error(`unexpected reply ${reply.type}`);
    if (reply.protocol !== PROTOCOL_VERSION) throw new Pb1Error(`the bridge speaks protocol ${reply.protocol}; PB-1 needs ${PROTOCOL_VERSION}`);
    if (reply.device !== "pb1") throw new Pb1Error(`that bridge serves ${reply.device}, not PB-1`);
    return reply;
  }

  async setup(flags: Flags): Promise<string> {
    await this.once("setup", argsFor("setup", flags));
    return `Setup complete: events, events_rich, events_rejected in ${where(flags)}`;
  }

  async reset(flags: Flags): Promise<string> {
    await this.once("reset", argsFor("reset", flags), undefined, true);
    return `Reset ${where(flags)}: tables recreated`;
  }

  async startQuery(): Promise<void> {
    await this.once("quack_start", {});
  }

  run(flags: Flags, onEvent: (event: RunEvent) => void): Running {
    const id = nextId("run");
    let done: DoneEvent | null = null;
    const finished = (async () => {
      const reply = await this.request({ type: "run", args: argsFor("run", flags) }, id, (m) => {
        if (!m.line || typeof m.line !== "object") return; // a line that wasn't JSON
        if (m.line.event === "done") done = m.line;
        onEvent(m.line);
      });
      if (reply.type !== "result") throw new Pb1Error(`unexpected reply ${reply.type}`);
      if (!reply.result.ok) throw new Pb1Error(firstLine(reply.result.error, "the run failed"), reply.result.code);
      if (!done) throw new Pb1Error(reply.result.stopped ? "stopped before Parkbench said done" : "Parkbench ended without saying done");
      return done as DoneEvent;
    })();
    return {
      done: finished,
      stop: async () => {
        await this.request({ type: "stop", request: id }, nextId("stop"));
      },
    };
  }

  readonly secrets = {
    types: SECRET_TYPES,
    list: async (): Promise<SecretInfo[]> => {
      const result = await this.once("secrets_list", {});
      const rows = (result.rows as Record<string, unknown>[] | undefined) ?? [];
      return rows.map((row) => ({
        name: String(row.name), type: String(row.type), provider: String(row.provider ?? ""),
        scope: Array.isArray(row.scope) ? row.scope.map(String) : [],
      }));
    },
    /** The values go to the engine in this one message, as `input`, never as arguments. */
    create: async (request: SecretRequest): Promise<SecretInfo[]> => {
      const values = { ...request.values, ...(request.scope ? { scope: request.scope } : {}) };
      await this.once("secrets_create", { type: request.secret_type, name: request.name }, { values }, true);
      return this.secrets.list();
    },
    drop: async (name: string): Promise<SecretInfo[]> => {
      await this.once("secrets_drop", { name }, undefined, true);
      return this.secrets.list();
    },
  };

  private async once(verb: string, args: Record<string, string>, input?: unknown, confirmed = false): Promise<Result> {
    const reply = await this.request({ type: verb, args, ...(input === undefined ? {} : { input }) }, nextId(verb), undefined, confirmed);
    if (reply.type !== "result") throw new Pb1Error(`unexpected reply ${reply.type}`);
    if (!reply.result.ok) throw new Pb1Error(firstLine(reply.result.error, `${verb} failed`), reply.result.code);
    return reply.result;
  }

  private request(body: Record<string, unknown>, id: string, onEvent?: Pending["onEvent"], confirmed = false): Promise<Message> {
    if (this.exited) return Promise.reject(new Pb1Error("the Parkbench bridge is not running"));
    return new Promise<Message>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onEvent });
      const line = JSON.stringify({ id, ...body });
      (confirmed ? this.transport.sendConfirmed(line) : this.transport.send(line)).catch((e) => {
        this.pending.delete(id);
        const text = String(e);
        reject(text === "cancelled" ? new Pb1Error("Cancelled.", "cancelled") : new Pb1Error(text));
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
    if (message.type === "accepted") return;
    if (message.type === "event") {
      pending.onEvent?.(message);
      return;
    }
    this.pending.delete(message.id!);
    if (message.type === "error") pending.reject(new Pb1Error(message.error, message.code));
    else pending.resolve(message);
  }

  private serverExited(): void {
    if (this.exited) return;
    this.exited = true;
    for (const pending of this.pending.values()) pending.reject(new Pb1Error("the Parkbench bridge stopped"));
    this.pending.clear();
    this.onExit();
  }
}

/** Where the flags point, for the display. */
function where(flags: Flags): string {
  if (typeof flags["ducklake-secret"] === "string") return flags["ducklake-secret"];
  return flags["metadata-store"] === "quack" || flags["metadata-store"] === "duckdb" ? "local duckdb" : "local postgres";
}
