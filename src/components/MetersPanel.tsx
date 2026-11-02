// METERS: cost LCD, token meters, and one LED per allowed iteration.

import { cacheHitRate, promptTokens, type RunView } from "../runState";

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function Meter({ label, value, fraction, accent }: { label: string; value: string; fraction: number; accent?: boolean }) {
  return (
    <div className="meter">
      <span className="meter-label">{label}</span>
      <div className="meter-bar">
        <div className={accent ? "fill accent" : "fill"} style={{ width: `${Math.min(100, fraction * 100)}%` }} />
      </div>
      <span className="meter-value">{value}</span>
    </div>
  );
}

interface Props {
  view: RunView;
  maxIterations: number;
  priced: boolean;
}

// Scale for the context meter: Haiku 5.5's long-prompt price starts at 100K, and the
// compressor (context editing) clears at 80K.
const CONTEXT_SCALE = 100_000;

export function MetersPanel({ view, maxIterations, priced }: Props) {
  const idle = view.phase === "idle";
  const leds = idle ? Array(maxIterations).fill("off") : view.leds;
  const prompt = promptTokens(view.usage);
  const hit = cacheHitRate(view.usage);
  const cost = view.costUsd == null ? (priced || idle ? "$0.0000" : "$ n/a") : `$${view.costUsd.toFixed(4)}`;

  return (
    <section className="panel meters">
      <h2>METERS</h2>
      <div className="lcd-row">
        <div className="lcd big" title={priced ? "Estimated cost of this run" : "No pricing for this model yet"}>
          <span className="lcd-label">COST</span>
          <span className="lcd-value">{cost}</span>
        </div>
        <div className="lcd big">
          <span className="lcd-label">ITERATION</span>
          <span className="lcd-value">
            {String(view.iteration).padStart(2, "0")}
            <small> / {idle ? maxIterations : view.maxIterations}</small>
          </span>
        </div>
      </div>

      <div className={`leds${leds.length > 30 ? " dense" : ""}`} aria-label={`Iteration ${view.iteration} of ${leds.length}`}>
        {leds.map((state, i) => (
          <span key={i} className={`iled ${state}`} title={`Iteration ${i + 1}`} />
        ))}
      </div>

      <Meter label="CONTEXT" value={compact(view.contextTokens)} fraction={view.contextTokens / CONTEXT_SCALE} />
      <Meter label="IN" value={compact(prompt)} fraction={prompt / 1_000_000} />
      <Meter label="OUT" value={compact(view.usage.output_tokens)} fraction={view.usage.output_tokens / 50_000} />
      <Meter label="CACHE" value={prompt ? `${Math.round(hit * 100)}%` : "—"} fraction={hit} accent />
    </section>
  );
}
