// A take from the traces, in the panel: a RUN's answer, an A/B's two answers side by side,
// or a SETLIST's grid (questions × columns, one mark per repeat), with AUTO GRADER's grades
// when it graded them. A take that's playing is shown live by Dh1Output instead.

import type { TakeRun, TakeSummary } from "@dh/dh1";
import { Markdown } from "@dh/ui-kit";
import { setlistGrid, takeTitle } from "./takes";

/** A grade for a run, from the AUTO GRADER's EH-1: its 0–6 total. */
export type RunGrades = Map<string, { total: number | null; rulesPassed: boolean | null }>;

const STATUS: Record<string, string> = {
  completed: "COMPLETED", max_iterations: "HIT ITERATION LIMIT", max_tokens: "HIT TOKEN LIMIT", cancelled: "STOPPED",
  refusal: "REFUSED", api_error: "API ERROR", error: "ERROR",
};

function Answer({ run, label }: { run: TakeRun; label?: string }) {
  return (
    <section className="output-answer">
      <div className="output-answer-head">
        {label && <span className="output-tag">{label}</span>}
        <span className="caps">{STATUS[run.status] ?? run.status.toUpperCase()}</span>
        <span className="muted mono">
          {run.iterations ?? "–"} iterations
          {run.duration_ms != null && ` · ${(run.duration_ms / 1000).toFixed(1)} s`}
          {run.cost_usd != null && ` · $${run.cost_usd.toFixed(4)}`}
        </span>
        {run.answer && <button className="bar-button" onClick={() => navigator.clipboard?.writeText(run.answer ?? "")}>Copy</button>}
      </div>
      <div className="output-answer-body">
        {run.answer ? <Markdown text={run.answer} /> : <p className="faint">No answer.</p>}
        {run.error && <p className="error">{run.error}</p>}
      </div>
    </section>
  );
}

export function TakeView({ take, runs, grades }: { take: TakeSummary; runs: TakeRun[] | null; grades: RunGrades | null }) {
  if (!runs) return <p className="muted">Reading the take…</p>;
  if (take.kind === "setlist") {
    const grid = setlistGrid(runs);
    return (
      <div className="output-setlist">
        <p className="output-prompt">{takeTitle(take)}</p>
        <p className="muted mono">
          {take.completed}/{take.runs} completed{take.cost_usd != null && ` · $${take.cost_usd.toFixed(4)}`}
          {grades ? ` · ${[...grades.values()].length} graded by AUTO GRADER` : ""}
        </p>
        <div className="take-grid" style={{ "--columns": grid.columns.length } as React.CSSProperties}>
          <span className="caps">QUESTION</span>
          {grid.columns.map((c) => <span key={c} className="caps">{c}</span>)}
          {grid.questions.map((q) => (
            <div key={q} className="take-row">
              <span className="take-q">{q}</span>
              {grid.columns.map((c) => (
                <span key={c} className="take-cell">
                  {grid.cell(q, c).map((r) => {
                    const g = grades?.get(r.run_id);
                    return (
                      <i key={r.run_id} className={`take-mark ${r.status === "completed" ? "ok" : "bad"}`}
                        title={`${q} · ${c} #${r.labels.repeat ?? 1}: ${r.status}${g?.total != null ? ` · ${g.total}/6` : ""}`}>
                        {g?.total != null ? g.total : ""}
                      </i>
                    );
                  })}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="output-run">
      <p className="output-prompt">{takeTitle(take)}</p>
      {take.kind === "ab" ? (
        <div className="output-ab">
          {runs.map((r) => <Answer key={r.run_id} run={r} label={String(r.labels.ab ?? "")} />)}
        </div>
      ) : (
        runs[0] && <Answer run={runs[0]} />
      )}
    </div>
  );
}
