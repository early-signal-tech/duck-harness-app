// DH-1's face: SOURCE, AGENT, and METERS across the top, the prompt and transport in the
// middle, the answer and the run's activity at the bottom.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Knob } from "./components/Knob";
import { Markdown } from "./components/Markdown";
import { MetersPanel } from "./components/MetersPanel";
import { SourcePanel } from "./components/SourcePanel";
import { Harness, type Effort, type Hello, type Run } from "./harness";
import { IDLE, runReducer } from "./runState";
import { loadSettings, MODELS, requestOf, saveSettings, sourceProblem, type FaceSettings } from "./settings";
import "./App.css";

type ServerStatus = "connecting" | "ready" | "down";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const MAX_ITERATIONS = 50;

const STATUS_TEXT: Record<string, string> = {
  completed: "COMPLETED",
  max_iterations: "HIT ITERATION LIMIT",
  max_tokens: "HIT TOKEN LIMIT",
  refusal: "REFUSED",
  context_window_exceeded: "CONTEXT FULL",
  unexpected_stop: "UNEXPECTED STOP",
  api_error: "API ERROR",
  error: "ERROR",
  interrupted: "INTERRUPTED",
  cancelled: "STOPPED",
};

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export default function App() {
  const harness = useRef<Harness | null>(null);
  const [server, setServer] = useState<ServerStatus>("connecting");
  const [hello, setHello] = useState<Hello | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const [settings, setSettings] = useState<FaceSettings>(loadSettings);
  const update = useCallback((patch: Partial<FaceSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  useEffect(() => saveSettings(settings), [settings]);

  const [view, dispatch] = useReducer(runReducer, IDLE);
  const run = useRef<Run | null>(null);
  const busy = view.phase === "running" || view.phase === "stopping";
  const now = useNow(busy);

  useEffect(() => {
    let disposed = false;
    let connected: Harness | null = null;
    Harness.connect()
      .then(async (h) => {
        if (disposed) return h.dispose();
        connected = harness.current = h;
        h.onExit = () => setServer("down");
        setHello(await h.hello());
        setServer("ready");
      })
      .catch((e) => {
        if (disposed) return;
        setServerError(e instanceof Error ? e.message : String(e));
        setServer("down");
      });
    return () => {
      disposed = true;
      connected?.dispose();
    };
  }, []);

  const problem = !settings.prompt.trim() ? "Type a question" : sourceProblem(settings);
  const canRun = server === "ready" && !busy && !problem;

  const start = useCallback(() => {
    const h = harness.current;
    if (!h || !canRun) return;
    dispatch({ type: "start", maxIterations: settings.maxIterations, at: Date.now() });
    const r = h.run(requestOf(settings), (event) => dispatch({ type: "event", event }));
    run.current = r;
    r.done
      .then((result) => dispatch({ type: "finished", result, at: Date.now() }))
      .catch((e) => dispatch({ type: "failed", error: e instanceof Error ? e.message : String(e), at: Date.now() }))
      .finally(() => {
        if (run.current === r) run.current = null;
      });
  }, [canRun, settings]);

  const stop = useCallback(() => {
    if (!run.current) return;
    dispatch({ type: "stopping" });
    run.current.stop().catch(() => {});
  }, []);

  // ⌘↵ runs, Esc stops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        start();
      } else if (e.key === "Escape" && busy) {
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start, stop, busy]);

  const elapsed = view.startedAt ? (view.endedAt ?? now) - view.startedAt : 0;
  const priced = hello ? hello.priced_models.includes(settings.model) : true;
  const effortIndex = Math.max(0, EFFORTS.indexOf(settings.effort));
  const result = view.result;

  let transport: string;
  if (view.phase === "running") transport = `RUNNING · ${clock(elapsed)}`;
  else if (view.phase === "stopping") transport = `STOPPING · ${clock(elapsed)}`;
  else if (view.phase === "done" && result) transport = `${STATUS_TEXT[result.status] ?? result.status.toUpperCase()} · ${clock(elapsed)}`;
  else if (view.phase === "failed") transport = "COULD NOT RUN";
  else transport = "READY";

  return (
    <div className="face">
      <header className="faceplate">
        <div className="brand">
          <span className="wordmark">DH-1</span>
          <span className="tagline">DUCK HARNESS · SQL ANALYTICS AGENT</span>
        </div>
        <div className={`server ${server}`} title={serverError ?? undefined}>
          <span className="led" />
          {server === "ready" ? "ENGINE READY" : server === "connecting" ? "STARTING ENGINE…" : "ENGINE OFFLINE"}
        </div>
      </header>

      <div className="rack">
        <SourcePanel settings={settings} update={update} />

        <section className="panel agent">
          <h2>AGENT</h2>
          <span className="field-label">MODEL</span>
          <div className="segmented three model" role="radiogroup" aria-label="Model">
            {MODELS.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={settings.model === m.id}
                className={settings.model === m.id ? "on" : ""}
                onClick={() => update({ model: m.id })}
                title={m.id}
              >
                <span className="led" />
                {m.label}
              </button>
            ))}
          </div>
          <div className="knobs">
            <Knob
              label="EFFORT"
              value={effortIndex}
              min={0}
              max={EFFORTS.length - 1}
              defaultValue={EFFORTS.indexOf(hello?.defaults.effort ?? "medium")}
              format={(i) => EFFORTS[i].toUpperCase()}
              hint="how hard Claude thinks"
              onChange={(i) => update({ effort: EFFORTS[i] })}
            />
            <Knob
              label="ITERATIONS"
              value={settings.maxIterations}
              min={1}
              max={MAX_ITERATIONS}
              defaultValue={hello?.defaults.max_iterations ?? 25}
              format={(n) => String(n)}
              hint="tool rounds before wrap-up"
              ticks={11}
              onChange={(n) => update({ maxIterations: n })}
            />
          </div>
          {!priced && <p className="note dim">No price table for this model yet, so the cost LCD reads n/a.</p>}
        </section>

        <MetersPanel view={view} maxIterations={settings.maxIterations} priced={priced} />
      </div>

      <section className="panel prompt">
        <h2>PROMPT</h2>
        <textarea
          value={settings.prompt}
          rows={2}
          spellCheck
          placeholder="Ask a question about your data…"
          onChange={(e) => update({ prompt: e.currentTarget.value })}
        />
        <div className="transport">
          <button className="run" disabled={!canRun} onClick={start} title={problem ?? "Run (⌘↵)"}>
            <span className="led" />
            RUN
          </button>
          <button className="stop" disabled={!busy || view.phase === "stopping"} onClick={stop} title="Stop (Esc)">
            STOP
          </button>
          <span className={`transport-status ${view.phase}${result ? ` ${result.status}` : ""}`}>{transport}</span>
          {!busy && problem && server === "ready" && <span className="hint">{problem}</span>}
        </div>
      </section>

      <div className="screens">
        <section className="panel screen answer">
          <h2>
            ANSWER
            {result?.text && (
              <button className="mini" onClick={() => navigator.clipboard?.writeText(result.text)}>
                Copy
              </button>
            )}
          </h2>
          <div className="screen-body">
            {view.phase === "idle" && <p className="dim">The answer appears here when a run finishes.</p>}
            {busy && <p className="dim blink">{view.phase === "stopping" ? "Stopping…" : "Working…"}</p>}
            {view.phase === "failed" && <p className="error">{view.error}</p>}
            {result && (
              <>
                {result.text ? <Markdown text={result.text} /> : null}
                {result.error && <p className="error">{result.error}</p>}
                {!result.text && !result.error && <p className="dim">No answer: the run was stopped.</p>}
                <p className="meta">
                  {result.iterations} iterations · {result.api_calls} API calls · {(result.duration_ms / 1000).toFixed(1)} s
                  {result.estimated_cost_usd != null && ` · $${result.estimated_cost_usd.toFixed(4)}`}
                  {" · "}
                  <span className="mono">{result.run_id}</span>
                </p>
              </>
            )}
          </div>
        </section>

        <section className="panel screen activity">
          <h2>ACTIVITY</h2>
          <ol className="screen-body">
            {view.activity.map((line, i) => (
              <li key={i} className={line.kind}>
                <span className="iter">{String(line.iteration).padStart(2, "0")}</span>
                <span className="what">{line.text}</span>
                {line.detail && <span className="detail">{line.detail}</span>}
              </li>
            ))}
            {view.activity.length === 0 && <li className="dim">Tool calls and thinking show up here.</li>}
          </ol>
        </section>
      </div>
    </div>
  );
}
