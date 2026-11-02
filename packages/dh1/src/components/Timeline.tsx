// RUN TIMELINE: the run as a waveform. One slot per allowed iteration; each bar's height
// is that iteration's prompt size, and its fill says what it did (listed tables,
// described, queried, failed, or answered). A blue tick marks a compressor clear, and
// the dashed line is the compressor's threshold. Click a bar to find it in the log.
// Closed by default: then it's one line with a short summary.

import { stepKind, type IterationInfo, type RunView, type StepKind } from "../runState";
import { kTokens } from "./CompressorPanel";

const LEGEND: { kind: StepKind; label: string }[] = [
  { kind: "list", label: "list tables" },
  { kind: "describe", label: "describe" },
  { kind: "query", label: "query" },
  { kind: "error", label: "error" },
  { kind: "answer", label: "answer" },
];

function describeStep(info: IterationInfo): string {
  const parts = [`Iteration ${info.iteration}`];
  if (info.tools.length) {
    const counts = new Map<string, number>();
    for (const t of info.tools) counts.set(t.label, (counts.get(t.label) ?? 0) + 1);
    parts.push([...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(", "));
  } else if (info.contextTokens !== null) {
    parts.push("answer");
  }
  const failed = info.tools.filter((t) => !t.success).length;
  if (failed) parts.push(`${failed} failed`);
  if (info.contextTokens !== null) parts.push(`${kTokens(info.contextTokens)} context`);
  if (info.cleared) parts.push(`cleared −${kTokens(info.cleared)}`);
  if (info.latencyMs !== null) parts.push(`${(info.latencyMs / 1000).toFixed(1)} s`);
  if (info.costUsd != null) parts.push(`$${info.costUsd.toFixed(4)}`);
  return parts.join(" · ");
}

interface Props {
  view: RunView;
  /** Slots to show before a run starts. */
  maxIterations: number;
  /** The compressor's threshold, or null when it's off. */
  threshold: number | null;
  selected: number | null;
  onSelect: (iteration: number | null) => void;
  open: boolean;
  onToggle: () => void;
}

/** The one-line summary shown while the timeline is closed. */
export function timelineSummary(view: RunView): string {
  if (view.phase === "idle") return "";
  const reached = view.iterations.length;
  const parts = [`${reached} iteration${reached === 1 ? "" : "s"}`];
  const clears = view.iterations.filter((i) => i.cleared > 0).length;
  if (clears) parts.push(`${clears} clear${clears === 1 ? "" : "s"}`);
  const errors = view.iterations.filter((i) => stepKind(i) === "error").length;
  if (errors) parts.push(`${errors} with errors`);
  return parts.join(" · ");
}

export function Timeline({ view, maxIterations, threshold, selected, onSelect, open, onToggle }: Props) {
  const idle = view.phase === "idle";
  const slots = idle ? maxIterations : view.maxIterations;
  const byIteration = new Map(view.iterations.map((i) => [i.iteration, i]));
  const peak = Math.max(0, ...view.iterations.map((i) => i.contextTokens ?? 0));
  // Scale to the tallest bar, or to the threshold if it's higher, so the line fits.
  const scale = Math.max(peak, threshold ?? 0, 10_000);
  const height = (tokens: number) => `${Math.max(6, (tokens / scale) * 100)}%`;

  return (
    <div className={`timeline${open ? "" : " closed"}`}>
      <div className="timeline-head">
        <button className="timeline-toggle caps" aria-expanded={open} onClick={onToggle} title={open ? "Hide the timeline" : "Show the timeline"}>
          <span className="chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
          RUN TIMELINE
          {!open && timelineSummary(view) && <span className="summary">{timelineSummary(view)}</span>}
        </button>
        {open && <div className="legend">
          {LEGEND.map(({ kind, label }) => (
            <span key={kind}><i className={`swatch ${kind}`} aria-hidden="true" />{label}</span>
          ))}
          <span><i className="swatch clear" aria-hidden="true" />clear</span>
        </div>}
      </div>
      {open && <div className="bars" role="list" aria-label="Iterations">
        {threshold !== null && !idle && (
          <div className="thr" style={{ bottom: `${(threshold / scale) * 100}%` }}>
            <span>THR {kTokens(threshold)}</span>
          </div>
        )}
        {Array.from({ length: slots }, (_, index) => {
          const n = index + 1;
          const info = byIteration.get(n);
          if (!info) return <div key={n} className="slot empty" role="listitem" aria-label={`Iteration ${n}: not reached`} />;
          const kind = info.calling ? "pending" : stepKind(info);
          return (
            <button
              key={n}
              role="listitem"
              className={`slot ${kind}${info.calling ? " calling" : ""}${selected === n ? " selected" : ""}`}
              title={describeStep(info)}
              aria-label={describeStep(info)}
              onClick={() => onSelect(selected === n ? null : n)}
            >
              <span className="bar" style={{ height: info.contextTokens === null ? "12%" : height(info.contextTokens) }}>
                {info.cleared > 0 && <span className="clear-mark" aria-hidden="true" />}
              </span>
            </button>
          );
        })}
      </div>}
    </div>
  );
}
