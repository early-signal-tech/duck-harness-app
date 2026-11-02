// The DH-1 device: SOURCE, AGENT, and METERS; the prompt bar; then the run's activity
// and the answer. A host (the standalone app, later the rack) gives it an engine
// connection (useEngine) and draws the window chrome around it. If the host gives it a
// toolbar element (a slot in its header bar), the preset bar goes there; otherwise the
// device shows it in a strip of its own.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Markdown, Splitter } from "@dh/ui-kit";
import { AgentPanel } from "./components/AgentPanel";
import { CompressorPanel } from "./components/CompressorPanel";
import { Detail } from "./components/Detail";
import { MetersPanel } from "./components/MetersPanel";
import { PresetBar } from "./components/PresetBar";
import { answerText, isAnswer, StructuredAnswer } from "./components/StructuredAnswer";
import { SourcePanel } from "./components/SourcePanel";
import type { Run } from "./harness";
import {
  DEFAULT_ANSWER_WIDTH, DEFAULT_TEXT_SIZE, loadLayout, MIN_ACTIVITY_WIDTH, MIN_ANSWER_WIDTH, saveLayout, stepTextSize,
  type Layout,
} from "./layout";
import { IDLE, runReducer } from "./runState";
import { loadSettings, requestOf, saveSettings, sourceProblem, type FaceSettings } from "./settings";
import "./dh1.css";
import type { EngineConnection } from "./useEngine";
import { usePresets } from "./usePresets";

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

export function Dh1({ engine, toolbar }: { engine: EngineConnection; toolbar?: HTMLElement | null }) {
  const { harness, status: server, hello } = engine;

  const [settings, setSettings] = useState<FaceSettings>(loadSettings);
  const update = useCallback((patch: Partial<FaceSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  useEffect(() => saveSettings(settings), [settings]);

  const presets = usePresets(settings, setSettings);

  const addFiles = useCallback((paths: string[]) => {
    setSettings((s) => ({ ...s, sourceKind: "files", files: [...new Set([...s.files, ...paths])] }));
  }, []);

  const [layout, setLayout] = useState<Layout>(loadLayout);
  useEffect(() => saveLayout(layout), [layout]);
  const changeTextSize = useCallback(
    (direction: 1 | -1 | 0) =>
      setLayout((l) => ({ ...l, textSize: direction === 0 ? DEFAULT_TEXT_SIZE : stepTextSize(l.textSize, direction) })),
    [],
  );
  const [expanded, setExpanded] = useState<Pane | null>(null);
  const screens = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLOListElement>(null);

  const [view, dispatch] = useReducer(runReducer, IDLE);
  const run = useRef<Run | null>(null);
  const busy = view.phase === "running" || view.phase === "stopping";

  // Keep the newest activity in view, unless you've scrolled up to read something.
  const following = useRef(true);
  useEffect(() => {
    const el = log.current;
    if (!el) return;
    const onScroll = () => {
      following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = log.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [view.activity.length]);
  useEffect(() => {
    if (view.phase === "running") following.current = true;
  }, [view.phase]);
  const now = useNow(busy);

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
    const h = harness;
    if (!h || !canRun) return;
    dispatch({ type: "start", maxIterations: settings.maxIterations, at: Date.now() });
    const preset = presets.current && {
      id: presets.current.id,
      name: presets.current.name,
      revision: presets.current.revision,
      modified: presets.modified,
    };
    const r = h.run(requestOf(settings, preset), (event) => dispatch({ type: "event", event }));
    run.current = r;
    r.done
      .then((result) => dispatch({ type: "finished", result, at: Date.now() }))
      .catch((e) => dispatch({ type: "failed", error: e instanceof Error ? e.message : String(e), at: Date.now() }))
      .finally(() => {
        if (run.current === r) run.current = null;
      });
  }, [canRun, harness, settings, presets.current, presets.modified]);

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
    <div className={`dh1${dragging ? " dragging" : ""}${expanded ? ` expanded-${expanded}` : ""}`}>
      {toolbar ? createPortal(<PresetBar presets={presets} settings={settings} />, toolbar) : (
        <div className="bar dh1-toolbar"><PresetBar presets={presets} settings={settings} /></div>
      )}

      <div className="dh1-row">
        <SourcePanel settings={settings} update={update} addFiles={addFiles} />

        <AgentPanel settings={settings} update={update} hello={hello} priced={priced} />

        <CompressorPanel
          settings={settings}
          update={update}
          view={view}
          tools={hello?.tools ?? ["list_tables", "describe_table", "sample_rows", "query_database"]}
        />

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
          <ol className="log" ref={log}>
            {view.activity.map((line, i) => (
              <li key={i} className={`${line.kind}${line.kind === "end" && !line.hasAnswer ? " no-answer" : ""}`}>
                <span className="iter">{line.kind === "end" ? "END" : String(line.iteration).padStart(2, "0")}</span>
                <div>
                  <span className="what">{line.text}</span>
                  {line.detail && <Detail text={line.detail} />}
                  {line.kind === "end" && line.hasAnswer && expanded === "activity" && (
                    <button className="pane-button show-answer" onClick={() => setExpanded("answer")}>
                      Show answer →
                    </button>
                  )}
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
          width={layout.answerWidth}
          minRight={MIN_ANSWER_WIDTH}
          minLeft={MIN_ACTIVITY_WIDTH}
          label="Resize the Activity and Answer panes"
          onChange={(answerWidth) => setLayout((l) => ({ ...l, answerWidth }))}
          onReset={() => setLayout((l) => ({ ...l, answerWidth: DEFAULT_ANSWER_WIDTH }))}
        />

        <section className="panel answer">
          <h2>
            ANSWER
            <div className="pane-tools">
              {result?.text && (
                <button
                  className="bar-button"
                  onClick={() => navigator.clipboard?.writeText(isAnswer(result.answer) ? answerText(result.answer) : result.text)}
                >
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
                {isAnswer(result.answer) ? <StructuredAnswer answer={result.answer} /> : result.text && <Markdown text={result.text} />}
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
