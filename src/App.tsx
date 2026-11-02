// Step 2 bench: proves the app <-> agent server bridge end to end. The plugin face
// (knobs, compressor, meters) replaces this in step 3.

import { useEffect, useRef, useState } from "react";
import { Harness, type AgentEvent, type AgentResult, type Effort, type Hello, type Run } from "./harness";
import "./App.css";

type Status = "connecting" | "ready" | "down";

function describe(event: AgentEvent): string {
  switch (event.event) {
    case "run_start":
      return `start · ${event.model} · effort ${event.effort}`;
    case "api_call_start":
      return `iteration ${event.iteration} · calling Claude…`;
    case "api_call":
      return `iteration ${event.iteration} · ${event.stop_reason} · ${event.latency_ms} ms · ${event.context_tokens.toLocaleString()} context tokens`;
    case "api_error":
      return `API error: ${event.error}`;
    case "context_edit":
      return `context edit · ${JSON.stringify(event.details)}`;
    case "thinking":
      return `thinking · ${event.text.slice(0, 160)}${event.text.length > 160 ? "…" : ""}`;
    case "tool_call_start":
      return `${event.label} · ${String(event.input.sql ?? event.input.table_name ?? "")}`.trim();
    case "tool_call":
      return event.success
        ? `${event.label} · ${event.row_count ?? 0} rows · ${event.duration_ms} ms`
        : `${event.label} · ${event.error_type}`;
    case "run_end":
      return `end · ${event.status}`;
  }
}

export default function App() {
  const harness = useRef<Harness | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [hello, setHello] = useState<Hello | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("Which 5 customers spent the most in 1997?");
  const [sourceKind, setSourceKind] = useState<"tpch" | "db">("tpch");
  const [dbPath, setDbPath] = useState("");
  const [effort, setEffort] = useState<Effort>("medium");

  const [run, setRun] = useState<Run | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [cost, setCost] = useState<number | null>(null);
  const [iteration, setIteration] = useState(0);
  const [result, setResult] = useState<AgentResult | null>(null);

  useEffect(() => {
    let disposed = false;
    let connected: Harness | null = null;
    Harness.connect().then(async (h) => {
      if (disposed) return h.dispose();
      connected = harness.current = h;
      h.onExit = () => setStatus("down");
      try {
        const info = await h.hello();
        setHello(info);
        setEffort(info.defaults.effort);
        setStatus("ready");
      } catch (e) {
        setError(String(e));
        setStatus("down");
      }
    });
    return () => {
      disposed = true;
      connected?.dispose();
    };
  }, []);

  function start() {
    const h = harness.current;
    if (!h || run) return;
    setLog([]);
    setCost(null);
    setIteration(0);
    setResult(null);
    setError(null);
    const r = h.run(
      {
        prompt,
        source: sourceKind === "tpch" ? { tpch: 0.1 } : { db: dbPath },
        config: { effort },
      },
      (event) => {
        setLog((lines) => [...lines, describe(event)]);
        if (event.event === "api_call") {
          setCost(event.total_cost_usd);
          setIteration(event.iteration);
        }
      },
    );
    setRun(r);
    r.done
      .then(setResult)
      .catch((e) => setError(String(e)))
      .finally(() => setRun(null));
  }

  return (
    <main className="bench">
      <header>
        <h1>DH-1</h1>
        <span className={`status ${status}`}>
          {status === "ready" ? `agent server · protocol ${hello?.protocol} · ${hello?.defaults.model}` : status === "connecting" ? "starting agent server…" : "agent server not running"}
        </span>
      </header>

      <section className="controls">
        <label>
          Source
          <select value={sourceKind} onChange={(e) => setSourceKind(e.currentTarget.value as "tpch" | "db")}>
            <option value="tpch">TPC-H test tone (SF 0.1)</option>
            <option value="db">DuckDB file…</option>
          </select>
        </label>
        {sourceKind === "db" && (
          <label className="grow">
            Path
            <input value={dbPath} placeholder="/path/to/data.duckdb" onChange={(e) => setDbPath(e.currentTarget.value)} />
          </label>
        )}
        <label>
          Effort
          <select value={effort} onChange={(e) => setEffort(e.currentTarget.value as Effort)}>
            {(hello?.effort_levels ?? ["low", "medium", "high", "xhigh", "max"]).map((level) => (
              <option key={level}>{level}</option>
            ))}
          </select>
        </label>
      </section>

      <textarea value={prompt} onChange={(e) => setPrompt(e.currentTarget.value)} rows={3} />

      <section className="transport">
        <button className="run" disabled={status !== "ready" || !!run || !prompt.trim()} onClick={start}>
          RUN
        </button>
        <button className="stop" disabled={!run} onClick={() => run?.stop()}>
          STOP
        </button>
        <span className="lcd">{cost == null ? "$—" : `$${cost.toFixed(4)}`}</span>
        <span className="lcd">iter {iteration}</span>
      </section>

      {error && <p className="error">{error}</p>}

      <section className="panes">
        <ol className="log">
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
        <div className="answer">
          {result ? (
            <>
              <p className="meta">
                {result.status} · {result.iterations} iterations · {(result.duration_ms / 1000).toFixed(1)} s
              </p>
              <p>{result.text || result.error}</p>
            </>
          ) : (
            <p className="meta">{run ? "running…" : "The answer appears here."}</p>
          )}
        </div>
      </section>
    </main>
  );
}
