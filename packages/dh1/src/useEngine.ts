// The connection to DH-1's engine (the Python agent server). The host app calls this
// once and passes the result to the device, and shows the engine light from `status`.

import { useEffect, useState } from "react";
import { Harness, type Hello } from "./harness";

export interface EngineConnection {
  harness: Harness | null;
  status: "connecting" | "ready" | "down";
  hello: Hello | null;
  error: string | null;
}

export function useEngine(): EngineConnection {
  const [engine, setEngine] = useState<EngineConnection>({ harness: null, status: "connecting", hello: null, error: null });

  useEffect(() => {
    let disposed = false;
    let connected: Harness | null = null;
    Harness.connect()
      .then(async (harness) => {
        if (disposed) return harness.dispose();
        connected = harness;
        harness.onExit = () => setEngine((e) => ({ ...e, status: "down" }));
        const hello = await harness.hello();
        setEngine({ harness, status: "ready", hello, error: null });
      })
      .catch((e) => {
        if (disposed) return;
        setEngine((current) => ({ ...current, status: "down", error: e instanceof Error ? e.message : String(e) }));
      });
    return () => {
      disposed = true;
      connected?.dispose();
    };
  }, []);

  return engine;
}
