// The connection to DH-1's engine (the Python agent server). The host app calls this
// once and passes the result to the device, and shows the engine light from `status`.
// `restart` stops the engine and starts it again, for settings that apply at start
// (the API key, the traces database); it cancels any runs.

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { Harness, type Hello } from "./harness";

export interface EngineConnection {
  harness: Harness | null;
  status: "connecting" | "ready" | "down";
  hello: Hello | null;
  error: string | null;
  restart: () => Promise<void>;
}

type EngineState = Omit<EngineConnection, "restart">;

const CONNECTING: EngineState = { harness: null, status: "connecting", hello: null, error: null };

export function useEngine(): EngineConnection {
  const [engine, setEngine] = useState<EngineState>(CONNECTING);
  // Bumped after a restart: reconnects to the new server.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let connected: Harness | null = null;
    Harness.connect()
      .then(async (harness) => {
        if (disposed) return harness.dispose();
        connected = harness;
        harness.onExit = () => {
          if (!disposed) setEngine((e) => ({ ...e, status: "down" }));
        };
        const hello = await harness.hello();
        if (!disposed) setEngine({ harness, status: "ready", hello, error: null });
      })
      .catch((e) => {
        if (disposed) return;
        setEngine((current) => ({ ...current, status: "down", error: e instanceof Error ? e.message : String(e) }));
      });
    return () => {
      disposed = true;
      connected?.dispose();
    };
  }, [attempt]);

  const restart = useCallback(async () => {
    setEngine(CONNECTING);
    try {
      await invoke<number>("engine_restart");
    } catch (e) {
      setEngine({ ...CONNECTING, status: "down", error: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      setAttempt((n) => n + 1);
    }
  }, []);

  return { ...engine, restart };
}
