import type { EngineTransport } from "@dh/ui-kit";
import { beforeEach, describe, expect, it } from "vitest";
import { Engine, EngineError, engineCan, type Hello } from "../engine";

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

describe("engineCan", () => {
  it("knows only what the running engine said in hello", () => {
    const hello = { verbs: { auth_login: {} } } as unknown as Hello;
    expect(engineCan(hello, "auth_login")).toBe(true);
    expect(engineCan(hello, "draft_publish")).toBe(false);
    expect(engineCan({} as Hello, "auth_login")).toBe(false);
    expect(engineCan(null, "auth_login")).toBe(false);
  });
});

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

  describe("discover", () => {
    const INPUT = { name: "a/b", image: "ghcr.io/estuary/source-mysql:v3", config: { password: "made-up" }, secret_paths: ["password"] };

    it("sends the input, the plane and the profile, and returns what was found", async () => {
      const job = engine.discover(INPUT, "ops/dp/public/x", "work");
      const id = await transport.lastId();
      expect(transport.sent[0]).toEqual({ id, type: "discover", args: { data_plane: "ops/dp/public/x" }, profile: "work", input: INPUT });
      transport.reply({ id, type: "result", result: { ok: true, catalog: { captures: {} }, bindings: [{ target: "a/b/t", resource: {} }] } });
      await expect(job.done).resolves.toMatchObject({ bindings: [{ target: "a/b/t" }] });
    });

    it("rejects with the bridge's message and code", async () => {
      const job = engine.discover(INPUT, "p", "work");
      transport.reply({ id: await transport.lastId(), type: "result", result: { ok: false, error: "can't connect", code: "tool_error" } });
      await expect(job.done).rejects.toMatchObject({ message: "can't connect", code: "tool_error" });
    });

    it("stops with a stop for that discover", async () => {
      const job = engine.discover(INPUT, "p", "work");
      job.done.catch(() => {});
      const id = await transport.lastId();
      const stopped = job.stop();
      const stopId = await transport.lastId();
      expect(transport.sent[1]).toEqual({ id: stopId, type: "stop", request: id });
      transport.reply({ id: stopId, type: "ok" });
      await stopped;
    });
  });

  describe("login", () => {
    const TOKEN = "made-up-token";

    it("waits for the page, sends the token once, and finishes on the result", async () => {
      const login = engine.login("work");
      const id = await transport.lastId();
      expect(transport.sent[0]).toEqual({ id, type: "auth_login", profile: "work" });
      transport.reply({ id, type: "accepted" });
      transport.reply({ id, type: "event", event: "waiting" });
      await login.waiting;

      const submitted = login.submit(TOKEN);
      const secretId = await transport.lastId();
      expect(transport.sent[1]).toEqual({ id: secretId, type: "secret", request: id, secret: TOKEN });
      transport.reply({ id: secretId, type: "ok" });
      await submitted;

      transport.reply({ id, type: "result", result: { ok: true, exit: 0 } });
      await expect(login.done).resolves.toBeUndefined();
    });

    it("rejects with the bridge's code when the token is refused", async () => {
      const login = engine.login("work");
      transport.reply({ id: await transport.lastId(), type: "result", result: { ok: false, error: "refused", code: "login_failed" } });
      await expect(login.done).rejects.toMatchObject({ code: "login_failed" });
      await expect(login.waiting).rejects.toMatchObject({ code: "login_failed" });
    });

    it("cancels with a stop for that login", async () => {
      const login = engine.login("work");
      login.done.catch(() => {});
      const id = await transport.lastId();
      const cancelled = login.cancel();
      const stopId = await transport.lastId();
      expect(transport.sent[1]).toEqual({ id: stopId, type: "stop", request: id });
      transport.reply({ id: stopId, type: "ok" });
      await cancelled;
    });
  });

  it("fails what's waiting when disposed", async () => {
    const done = engine.once("catalog_list", {}, "default");
    await transport.lastId();
    engine.dispose();
    await expect(done).rejects.toThrow("restarted");
  });
});
