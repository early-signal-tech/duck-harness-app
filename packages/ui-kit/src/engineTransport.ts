// How a device's client reaches its engine. The host decides: in the Tauri apps it's
// `tauriTransport(name)`, which talks to the engine of that name through the shared host
// crate (crates/dh-host, engines.rs). Several engines share one host (the rack), so every
// call and event names its engine.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface EngineTransport {
  /** The engine's name: "dh1", "eh1" or "es1". */
  readonly engine: string;
  /** Send one request line (a JSON object, no newline). */
  send(line: string): Promise<void>;
  /** Which start of the engine is current (it goes up on every start). */
  generation(): Promise<number>;
  /** Stop the engine and start it again; resolves with the new generation. */
  restart(): Promise<number>;
  /** Each line the engine writes. Resolves with a function that stops listening. */
  onMessage(handler: (line: string) => void): Promise<() => void>;
  /** The engine's exit, with the generation that exited. */
  onExit(handler: (generation: number) => void): Promise<() => void>;
}

interface MessageEvent {
  engine: string;
  line: string;
}

interface ExitEvent {
  engine: string;
  generation: number;
}

/** Only the events for `engine`: the others belong to another device's engine. */
export function forEngine<T extends { engine: string }>(engine: string, handler: (payload: T) => void) {
  return ({ payload }: { payload: T }) => {
    if (payload.engine === engine) handler(payload);
  };
}

export function tauriTransport(engine: string): EngineTransport {
  return {
    engine,
    send: (line) => invoke("engine_send", { engine, line }),
    generation: () => invoke<number>("engine_generation", { engine }),
    restart: () => invoke<number>("engine_restart", { engine }),
    onMessage: (handler) => listen<MessageEvent>("engine-message", forEngine(engine, (p) => handler(p.line))),
    onExit: (handler) => listen<ExitEvent>("engine-exit", forEngine(engine, (p) => handler(p.generation))),
  };
}
