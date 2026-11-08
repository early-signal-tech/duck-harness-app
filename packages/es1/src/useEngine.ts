// The connection to ES-1's engine (the flowctl bridge). The host calls this once with the
// transport to that engine (keep it stable: a new one reconnects), passes it to the
// device, and shows the engine light from `status`. `restart` is for settings that apply
// at start.

import type { EngineTransport } from "@dh/ui-kit";
import { useCallback, useEffect, useState } from "react";
import { Engine, type Hello } from "./engine";

export interface EngineConnection {
  engine: Engine | null;
  status: "connecting" | "ready" | "down";
  hello: Hello | null;
  error: string | null;
  restart: () => Promise<void>;
}

type State = Omit<EngineConnection, "restart">;
const CONNECTING: State = { engine: null, status: "connecting", hello: null, error: null };

export function useEngine(transport: EngineTransport): EngineConnection {
  const [state, setState] = useState<State>(CONNECTING);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let connected: Engine | null = null;
    Engine.connect(transport)
      .then(async (engine) => {
        if (disposed) return engine.dispose();
        connected = engine;
        engine.onExit = () => {
          if (!disposed) setState((s) => ({ ...s, status: "down" }));
        };
        const hello = await engine.hello();
        if (!disposed) setState({ engine, status: "ready", hello, error: null });
      })
      .catch((e) => {
        if (!disposed) setState((s) => ({ ...s, status: "down", error: e instanceof Error ? e.message : String(e) }));
      });
    return () => {
      disposed = true;
      connected?.dispose();
    };
  }, [transport, attempt]);

  const restart = useCallback(async () => {
    setState(CONNECTING);
    try {
      await transport.restart();
    } catch (e) {
      setState({ ...CONNECTING, status: "down", error: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      setAttempt((n) => n + 1);
    }
  }, [transport]);

  return { ...state, restart };
}
