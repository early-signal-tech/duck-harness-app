import type { EngineTransport } from "@dh/ui-kit";
import { beforeEach, describe, expect, it } from "vitest";
import { Engine, EngineError } from "../engine";

class FakeTransport implements EngineTransport {
  readonly engine = "es1";
  sent: Record<string, unknown>[] = [];
  private message: (line: string) => void = () => {};
  private exit: (generation: number) => void = () => {};
  async send(line: string) {
    this.sent.push(JSON.parse(line));
  }
  async generation() {
    return 3;
  }
  async restart() {
    return 4;
  }
  async onMessage(handler: (line: string) => void) {
    this.message = handler;
    return () => {};
  }
  async onExit(handler: (generation: number) => void) {
    this.exit = handler;
    return () => {};
  }
  reply(message: Record<string, unknown>) {
    this.message(JSON.stringify(message));
  }
  raw(line: string) {
    this.message(line);
  }
  exited(generation: number) {
    this.exit(generation);
  }
  /** Let the request go out, then return its id. */
  async lastId() {
    await Promise.resolve();
    return this.sent[this.sent.length - 1].id as string;
  }
}

describe("Engine", () => {
  let transport: FakeTransport;
  let engine: Engine;

  beforeEach(async () => {
    transport = new FakeTransport();
    engine = await Engine.connect(transport);
  });

  it("checks the protocol in hello", async () => {
    const good = engine.hello();
    transport.reply({ id: await transport.lastId(), type: "hello", protocol: 1, version: "0.1.0", device: "es1", tool: { status: "tested" } });
    await expect(good).resolves.toMatchObject({ device: "es1" });

    const bad = engine.hello();
    transport.reply({ id: await transport.lastId(), type: "hello", protocol: 2 });
    await expect(bad).rejects.toThrow("protocol 2");
  });

  it("sends the verb with its args and profile, and waits past accepted and events", async () => {
    let settled = false;
    const done = engine.once("catalog_list", { prefix: "a/" }, "work").finally(() => { settled = true; });
    const id = await transport.lastId();
    expect(transport.sent[0]).toEqual({ id, type: "catalog_list", args: { prefix: "a/" }, profile: "work" });

    transport.reply({ id, type: "accepted" });
    transport.reply({ id, type: "event", event: "line" });
    await Promise.resolve();
    expect(settled).toBe(false);

    transport.reply({ id, type: "result", result: { ok: true, rows: [{ a: 1 }], count: 1, truncated: false, bad_lines: 0, snapshot: "/s.jsonl" } });
    await expect(done).resolves.toMatchObject({ rows: [{ a: 1 }], snapshot: "/s.jsonl" });
  });

  it("rejects a failed command with the bridge's code", async () => {
    const done = engine.once("catalog_list", {}, "nobody");
    transport.reply({ id: await transport.lastId(), type: "result", result: { ok: false, error: "no login", code: "not_logged_in" } });
    const error = await done.catch((e) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect(error.code).toBe("not_logged_in");
    expect(error.message).toBe("no login");
  });

  it("rejects a refused request with its code", async () => {
    const done = engine.once("catalog_list", {}, "-bad");
    transport.reply({ id: await transport.lastId(), type: "error", error: "bad profile", code: "bad_request" });
    await expect(done).rejects.toMatchObject({ code: "bad_request" });
  });

  it("ignores lines it can't read and replies nobody's waiting for", async () => {
    const done = engine.once("catalog_list", {}, "default");
    const id = await transport.lastId();
    transport.raw("not json");
    transport.reply({ id: "someone-else", type: "result", result: { ok: true } });
    transport.reply({ id, type: "result", result: { ok: true, rows: [], count: 0, truncated: false, bad_lines: 0, snapshot: null } });
    await expect(done).resolves.toMatchObject({ count: 0 });
  });

  it("fails what's waiting when its own generation exits, not an older one", async () => {
    let exits = 0;
    engine.onExit = () => { exits++; };
    const done = engine.once("catalog_list", {}, "default");
    await transport.lastId();

    transport.exited(2);
    expect(exits).toBe(0);

    transport.exited(3);
    expect(exits).toBe(1);
    await expect(done).rejects.toThrow("stopped");
    await expect(engine.once("catalog_list", {}, "default")).rejects.toThrow("not running");
  });

  it("fails what's waiting when disposed", async () => {
    const done = engine.once("catalog_list", {}, "default");
    await transport.lastId();
    engine.dispose();
    await expect(done).rejects.toThrow("restarted");
  });
});
