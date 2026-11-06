// What DH-1 produced, for the rack's top panel when no device is open: the latest take.
// A RUN shows its answer; an A/B shows both answers side by side; a SETLIST shows its
// progress. The full activity, timeline, and the setlist's grid are in DH-1's editor.
// A view of the same model the editor draws (useDh1).

import { Markdown } from "@dh/ui-kit";
import { answerText, isAnswer, StructuredAnswer } from "./components/StructuredAnswer";
import type { RunView } from "./runState";
import { progressOf, setlistTitle } from "./setlist";
import type { Dh1Model } from "./useDh1";

export type TakeKind = "run" | "ab" | "setlist";

const STATUS_TEXT: Record<string, string> = {
  completed: "COMPLETED",
  max_iterations: "HIT ITERATION LIMIT",
  max_tokens: "HIT TOKEN LIMIT",
  refusal: "REFUSED",
  cancelled: "STOPPED",
  api_error: "API ERROR",
  error: "ERROR",
};

function phaseText(view: RunView): string {
  if (view.phase === "running") return `RUNNING · iteration ${view.iteration}`;
  if (view.phase === "stopping") return "STOPPING";
  if (view.phase === "failed") return "COULD NOT RUN";
  if (view.result) return STATUS_TEXT[view.result.status] ?? view.result.status.toUpperCase();
  return "";
}

/** One run's answer, as the editor's ANSWER pane shows it. */
function Answer({ view, label }: { view: RunView; label?: string }) {
  const result = view.result;
  return (
    <section className="output-answer">
      <div className="output-answer-head">
        {label && <span className="output-tag">{label}</span>}
        <span className="caps">{phaseText(view)}</span>
        {result && (
          <span className="muted mono">
            {result.iterations} iterations · {(result.duration_ms / 1000).toFixed(1)} s
            {result.estimated_cost_usd != null && ` · $${result.estimated_cost_usd.toFixed(4)}`}
          </span>
        )}
        {result?.text && (
          <button className="bar-button" onClick={() => navigator.clipboard?.writeText(isAnswer(result.answer) ? answerText(result.answer) : result.text)}>
            Copy
          </button>
        )}
      </div>
      <div className="output-answer-body">
        {view.phase === "idle" && <p className="faint">No answer yet.</p>}
        {(view.phase === "running" || view.phase === "stopping") && <p className="faint pulse">Working…</p>}
        {view.phase === "failed" && <p className="error">{view.error}</p>}
        {result && (
          <>
            {isAnswer(result.answer) ? <StructuredAnswer answer={result.answer} /> : result.text && <Markdown text={result.text} />}
            {result.error && <p className="error">{result.error}</p>}
            {!result.text && !result.error && <p className="faint">No answer: the run was stopped.</p>}
          </>
        )}
      </div>
    </section>
  );
}

export function Dh1Output({ model, kind, prompt, onOpenActivity }: {
  model: Dh1Model;
  kind: TakeKind;
  /** What the take asked (the prompt may have changed since). */
  prompt: string;
  /** Open DH-1's editor (its activity, timeline, and setlist grid). */
  onOpenActivity: () => void;
}) {
  if (kind === "setlist") {
    const { state } = model.setlist;
    const p = progressOf(state);
    const title = state.plan ? setlistTitle(state.plan, state.startedAt ? new Date(state.startedAt) : undefined) : "No setlist yet";
    return (
      <div className="output-setlist">
        <p className="output-prompt">{title}</p>
        <div className="output-progress" aria-label={`${p.settled} of ${p.total} runs done`}>
          <i style={{ width: `${p.total ? (p.settled / p.total) * 100 : 0}%` }} />
        </div>
        <p className="muted mono">
          {p.settled} / {p.total} runs{p.running ? ` · ${p.running} playing` : ""} · ${p.spent.toFixed(4)}
          {p.projected != null && p.settled < p.total ? ` · ~$${p.projected.toFixed(3)} when done` : ""}
        </p>
        <div className="output-jobs" aria-hidden="true">
          {state.jobs.map((job, i) => <i key={i} className={job.state} title={job.state} />)}
        </div>
        <button className="pane-button" onClick={onOpenActivity}>Open DH-1's setlist ▸</button>
      </div>
    );
  }
  return (
    <div className="output-run">
      <p className="output-prompt">{prompt || "Nothing played yet."}</p>
      {kind === "ab" ? (
        <div className="output-ab">
          <Answer view={model.views.A} label="A" />
          <Answer view={model.views.B} label="B" />
        </div>
      ) : (
        <Answer view={model.view} />
      )}
      <button className="pane-button output-activity" onClick={onOpenActivity}>
        ▸ Activity: {model.view.activity.length} {model.view.activity.length === 1 ? "step" : "steps"} · open DH-1
      </button>
    </div>
  );
}
