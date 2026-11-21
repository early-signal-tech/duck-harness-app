// The connection to PB-1's engine (cli-bridge's pb1-serve). The host calls this once with the
// transport to that engine (keep it stable: a new one reconnects) and passes it to the panel.
// `warning` is what hello says about Parkbench: missing, or a version nobody has tested.

import type { EngineTransport } from "@dh/ui-kit";
import { useEffect, useState } from "react";
import { Bridge } from "./bridge";
import type { Pb1Connection } from "./engine";

const CONNECTING: Pb1Connection = { engine: null, status: "connecting", error: null, warning: null };

export function useBridge(transport: EngineTransport): Pb1Connection {
  const [state, setState] = useState<Pb1Connection>(CONNECTING);

  useEffect(() => {
    let disposed = false;
    let connected: Bridge | null = null;
    Bridge.connect(transport)
      .then(async (bridge) => {
        if (disposed) return bridge.dispose();
        connected = bridge;
        bridge.onExit = () => {
          if (!disposed) setState((s) => ({ ...s, status: "down", error: "the Parkbench bridge stopped" }));
        };
        const hello = await bridge.hello();
        if (disposed) return;
        const tool = hello.tool;
        setState({
          engine: bridge,
          // Without Parkbench nothing can run: the panel says why, and stays dark.
          status: tool.status === "missing" ? "down" : "ready",
          error: tool.status === "missing" ? tool.warning : null,
          warning: tool.status === "untested" ? tool.warning : null,
        });
      })
      .catch((e) => {
        if (!disposed) setState({ ...CONNECTING, status: "down", error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      disposed = true;
      connected?.dispose();
    };
  }, [transport]);

  return state;
}
