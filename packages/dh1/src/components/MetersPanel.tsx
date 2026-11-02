// METERS: vertical token meters, the cost display, iteration LEDs, and the run status.

import { cacheHitRate, promptTokens, type RunView } from "../runState";

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function Meter({ label, value, fraction, accent }: { label: string; value: string; fraction: number; accent?: boolean }) {
  return (
    <div className="vmeter">
      <div className="vmeter-bar">
        <div className={accent ? "fill accent" : "fill"} style={{ height: `${Math.min(100, Math.max(0, fraction) * 100)}%` }} />
      </div>
      <span className="caps">{label}</span>
      <span className="small muted mono">{value}</span>
    </div>
  );
}

interface Props {
  view: RunView;
  maxIterations: number;
  priced: boolean;
  status: string;
  statusTone: "idle" | "busy" | "ok" | "warn" | "bad";
}

// Meter scales: run totals, scaled to a typical longer run. (The prompt's current size
// is on the compressor's CONTEXT IN meter.)
const IN_SCALE = 200_000;
const OUT_SCALE = 20_000;

export function MetersPanel({ view, maxIterations, priced, status, statusTone }: Props) {
  const idle = view.phase === "idle";
  const leds = idle ? Array(maxIterations).fill("off") : view.leds;
  const total = idle ? maxIterations : view.maxIterations;
  const prompt = promptTokens(view.usage);
  const hit = cacheHitRate(view.usage);
  const cost = view.costUsd == null ? (priced || idle ? "$0.0000" : "n/a") : `$${view.costUsd.toFixed(4)}`;

  return (
    <section className="panel meters">
      <h2>METERS</h2>
      <div className="vmeters">
        <Meter label="IN" value={compact(prompt)} fraction={prompt / IN_SCALE} />
        <Meter label="OUT" value={compact(view.usage.output_tokens)} fraction={view.usage.output_tokens / OUT_SCALE} />
        <Meter label="CACHE" value={prompt ? `${Math.round(hit * 100)}%` : "—"} fraction={hit} accent />
      </div>

      <div className="display" title={priced ? "Estimated cost of this run" : "No pricing for this model yet"}>
        <span className="caps">COST</span>
        <span className="display-value">{cost}</span>
      </div>

      <div className="field">
        <div className="caps row-between">
          <span>ITERATION</span>
          <span>
            {String(view.iteration).padStart(2, "0")} / {total}
          </span>
        </div>
        <div className="leds" aria-label={`Iteration ${view.iteration} of ${leds.length}`}>
          {leds.map((state, i) => (
            <span key={i} className={`iled ${state}`} title={`Iteration ${i + 1}`} />
          ))}
        </div>
      </div>

      <div className={`run-status caps ${statusTone}`}>
        <span className="dot" aria-hidden="true" />
        {status}
      </div>
    </section>
  );
}
