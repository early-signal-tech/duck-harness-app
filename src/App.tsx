// DH-1's face, laid out like the wireframe: a header bar; SOURCE, AGENT, and METERS;
// the prompt bar; then the run's activity and the answer.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  applyAppearance, loadAppearance, saveAppearance, watchSystemTheme,
  type Appearance, type DisplayStyle, type ThemeChoice,
} from "./appearance";
import { Knob } from "./components/Knob";
import { Markdown } from "./components/Markdown";
import { MetersPanel } from "./components/MetersPanel";
import { SourcePanel } from "./components/SourcePanel";
import { Splitter } from "./components/Splitter";
import { Harness, type Effort, type Hello, type Run } from "./harness";
import { DEFAULT_ANSWER_WIDTH, DEFAULT_TEXT_SIZE, loadLayout, saveLayout, stepTextSize, type Layout } from "./layout";
import { IDLE, runReducer } from "./runState";
import { loadSettings, MODELS, requestOf, saveSettings, sourceProblem, type FaceSettings } from "./settings";
import "./App.css";

type ServerStatus = "connecting" | "ready" | "down";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const MAX_ITERATIONS = 50;
const DATA_FILE = /\.(csv|tsv|parquet|json|jsonl|ndjson)(\.gz)?$/i;

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

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "LIGHT" },
  { value: "dark", label: "DARK" },
  { value: "system", label: "AUTO" },
];

const DISPLAYS: { value: DisplayStyle; label: string }[] = [
  { value: "dark", label: "DARK" },
  { value: "light", label: "LIGHT" },
];

function BarSwitch<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="bar-switch">
      <span>{label}</span>
      <div role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type Pane = "activity" | "answer";

/** A− / A+ and Expand, in each bottom pane's header. */
function PaneTools({ pane, expanded, textSize, onTextSize, onExpand, dark }: {
  pane: Pane;
  expanded: Pane | null;
  textSize: number;
  onTextSize: (direction: 1 | -1) => void;
  onExpand: (pane: Pane | null) => void;
  dark?: boolean;
}) {
  const cls = dark ? "bar-button" : "pane-button";
  const isOpen = expanded === pane;
  return (
    <div className="pane-tools">
      <button className={cls} onClick={() => onTextSize(-1)} title="Smaller text (⌘−)" aria-label="Smaller text">A−</button>
      <span className="pane-size" aria-live="polite">{textSize}</span>
      <button className={cls} onClick={() => onTextSize(1)} title="Larger text (⌘+)" aria-label="Larger text">A+</button>
      <button className={cls} onClick={() => onExpand(isOpen ? null : pane)} title={isOpen ? "Back to the face (Esc)" : "Fill the window"}>
        {isOpen ? "Collapse ↙" : "Expand ↗"}
      </button>
    </div>
  );
}

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

  const addFiles = useCallback((paths: string[]) => {
    setSettings((s) => ({ ...s, sourceKind: "files", files: [...new Set([...s.files, ...paths])] }));
  }, []);

  const [appearance, setAppearance] = useState<Appearance>(loadAppearance);
  useEffect(() => {
    applyAppearance(appearance);
    saveAppearance(appearance);
    if (appearance.theme !== "system") return;
    return watchSystemTheme(() => applyAppearance(appearance));
  }, [appearance]);

  const [layout, setLayout] = useState<Layout>(loadLayout);
  useEffect(() => saveLayout(layout), [layout]);
  const changeTextSize = useCallback(
    (direction: 1 | -1 | 0) =>
      setLayout((l) => ({ ...l, textSize: direction === 0 ? DEFAULT_TEXT_SIZE : stepTextSize(l.textSize, direction) })),
    [],
  );
  const [expanded, setExpanded] = useState<Pane | null>(null);
  const screens = useRef<HTMLDivElement>(null);

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

  // Data files dropped anywhere on the window go to the sampler.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      getCurrentWebview()
        .onDragDropEvent(({ payload }) => {
          if (payload.type === "enter" || payload.type === "over") setDragging(true);
          else setDragging(false);
          if (payload.type === "drop") {
            const files = payload.paths.filter((p) => DATA_FILE.test(p));
            if (files.length) addFiles(files);
          }
        })
        .then((stop) => (disposed ? stop() : (unlisten = stop)))
        .catch(() => {});
    } catch {
      // Not running inside Tauri.
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addFiles]);

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

  // Enter (in the prompt) or ⌘↵ runs. Esc leaves an expanded pane, otherwise stops a
  // run. ⌘+ / ⌘− / ⌘0 change the Activity and Answer text size.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const command = e.metaKey || e.ctrlKey;
      if (e.key === "Enter" && command) {
        e.preventDefault();
        start();
      } else if (e.key === "Escape") {
        if (expanded) setExpanded(null);
        else if (busy) stop();
      } else if (command && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        changeTextSize(1);
      } else if (command && e.key === "-") {
        e.preventDefault();
        changeTextSize(-1);
      } else if (command && e.key === "0") {
        e.preventDefault();
        changeTextSize(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start, stop, busy, expanded, changeTextSize]);

  const elapsed = view.startedAt ? (view.endedAt ?? now) - view.startedAt : 0;
  const priced = hello ? hello.priced_models.includes(settings.model) : true;
  const effortIndex = Math.max(0, EFFORTS.indexOf(settings.effort));
  const result = view.result;

  let status: string;
  let tone: "idle" | "busy" | "ok" | "warn" | "bad";
  if (view.phase === "running") [status, tone] = [`RUNNING · ${clock(elapsed)}`, "busy"];
  else if (view.phase === "stopping") [status, tone] = [`STOPPING · ${clock(elapsed)}`, "busy"];
  else if (view.phase === "done" && result) {
    status = `${STATUS_TEXT[result.status] ?? result.status.toUpperCase()} · ${clock(elapsed)}`;
    tone = result.status === "completed" ? "ok" : ["cancelled", "max_iterations", "max_tokens"].includes(result.status) ? "warn" : "bad";
  } else if (view.phase === "failed") [status, tone] = ["COULD NOT RUN", "bad"];
  else [status, tone] = [server === "ready" ? "READY" : server === "connecting" ? "STARTING ENGINE…" : "ENGINE OFFLINE", server === "down" ? "bad" : "idle"];

  return (
    <div className={`face${dragging ? " dragging" : ""}${expanded ? ` expanded-${expanded}` : ""}`}>
      <header className="bar">
        <div className="brand">
          <span className="wordmark">DH-1</span>
          <span className="tagline">DUCK HARNESS · SQL ANALYTICS AGENT</span>
        </div>
        <div className="spacer" />
        <BarSwitch label="THEME" options={THEMES} value={appearance.theme} onChange={(theme) => setAppearance((a) => ({ ...a, theme }))} />
        <BarSwitch label="DISPLAYS" options={DISPLAYS} value={appearance.displays} onChange={(displays) => setAppearance((a) => ({ ...a, displays }))} />
        <div className={`engine ${server}`} title={serverError ?? undefined}>
          <span className="dot" aria-hidden="true" />
          {server === "ready" ? "ENGINE" : server === "connecting" ? "STARTING" : "OFFLINE"}
        </div>
      </header>

      <div className="rack">
        <SourcePanel settings={settings} update={update} addFiles={addFiles} />

        <section className="panel agent">
          <h2>AGENT</h2>
          <div className="model-row">
            <span className="caps muted">MODEL</span>
            <div className="segmented" role="radiogroup" aria-label="Model">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={settings.model === m.id}
                  className={settings.model === m.id ? "on" : ""}
                  onClick={() => update({ model: m.id })}
                  title={m.id}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="knobs">
            <Knob
              label="EFFORT"
              value={effortIndex}
              min={0}
              max={EFFORTS.length - 1}
              defaultValue={EFFORTS.indexOf(hello?.defaults.effort ?? "medium")}
              format={(i) => EFFORTS[i].toUpperCase()}
              hint="low · med · high · xhigh · max"
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
              onChange={(n) => update({ maxIterations: n })}
            />
          </div>
          <div className="panel-foot">
            <span className="small muted">
              {priced ? "Drag, scroll, or use arrow keys · double-click resets" : "No price table for this model yet, so cost reads n/a"}
            </span>
          </div>
        </section>

        <MetersPanel view={view} maxIterations={settings.maxIterations} priced={priced} status={status} statusTone={tone} />
      </div>

      <div className="panel prompt">
        <label className="title" htmlFor="prompt">PROMPT</label>
        <input
          id="prompt"
          value={settings.prompt}
          spellCheck
          placeholder="Ask a question about your data…"
          onChange={(e) => update({ prompt: e.currentTarget.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              start();
            }
          }}
        />
        <button className="run" disabled={!canRun} onClick={start} title={problem ?? "Run (↵)"}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4l14 8-14 8z" /></svg>
          RUN
        </button>
        <button className="stop" disabled={!busy || view.phase === "stopping"} onClick={stop} title="Stop (Esc)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="16" height="16" /></svg>
          STOP
        </button>
      </div>

      <div
        className="screens"
        ref={screens}
        style={{ "--pane-text": `${layout.textSize}px`, "--answer-width": `${layout.answerWidth}px` } as React.CSSProperties}
      >
        <section className="panel activity">
          <h2>
            ACTIVITY
            <PaneTools pane="activity" expanded={expanded} textSize={layout.textSize} onTextSize={changeTextSize} onExpand={setExpanded} />
          </h2>
          <ol className="log">
            {view.activity.map((line, i) => (
              <li key={i} className={line.kind}>
                <span className="iter">{String(line.iteration).padStart(2, "0")}</span>
                <div>
                  <span className="what">{line.text}</span>
                  {line.detail && <code className="detail">{line.detail}</code>}
                </div>
              </li>
            ))}
            {view.activity.length === 0 && (
              <li className="empty muted">{!busy && problem && server === "ready" ? problem : "Tool calls and thinking show up here."}</li>
            )}
          </ol>
        </section>

        <Splitter
          container={screens}
          answerWidth={layout.answerWidth}
          onChange={(answerWidth) => setLayout((l) => ({ ...l, answerWidth }))}
          onReset={() => setLayout((l) => ({ ...l, answerWidth: DEFAULT_ANSWER_WIDTH }))}
        />

        <section className="panel answer">
          <h2>
            ANSWER
            <div className="pane-tools">
              {result?.text && (
                <button className="bar-button" onClick={() => navigator.clipboard?.writeText(result.text)}>
                  Copy
                </button>
              )}
              <PaneTools pane="answer" expanded={expanded} textSize={layout.textSize} onTextSize={changeTextSize} onExpand={setExpanded} dark />
            </div>
          </h2>
          <div className="answer-well">
            {view.phase === "idle" && <p className="faint">The answer appears here when a run finishes.</p>}
            {busy && <p className="faint pulse">{view.phase === "stopping" ? "Stopping…" : "Working…"}</p>}
            {view.phase === "failed" && <p className="error">{view.error}</p>}
            {result && (
              <>
                {result.text && <Markdown text={result.text} />}
                {result.error && <p className="error">{result.error}</p>}
                {!result.text && !result.error && <p className="faint">No answer: the run was stopped.</p>}
                <p className="answer-meta">
                  {result.iterations} iterations · {result.api_calls} API calls · {(result.duration_ms / 1000).toFixed(1)} s
                  {result.estimated_cost_usd != null && ` · $${result.estimated_cost_usd.toFixed(4)}`}
                  <br />
                  <span className="selectable">{result.run_id}</span>
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
