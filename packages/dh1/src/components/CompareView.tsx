// A/B COMPARE: the same prompt on the same data with two sets of settings, side by
// side. Which settings differ, how each run went, and both answers. Judging which is
// better is EH-1's job; this shows the facts.

import { Markdown } from "@dh/ui-kit";
import { diffSettings, settingsForSlot, type Slot } from "../ab";
import { presetRef, type Preset } from "../presets";
import { cacheHitRate, promptTokens, type RunView } from "../runState";
import { agentSettingsOf, type FaceSettings } from "../settings";
import { kTokens } from "./CompressorPanel";
import { isAnswer, StructuredAnswer } from "./StructuredAnswer";

interface Props {
  face: FaceSettings;
  views: Record<Slot, RunView>;
  presets: Preset[];
  onBack: () => void;
  /** The same text size as the Activity and Answer panes (A− / A+, ⌘+ / ⌘−). */
  textSize: number;
  onTextSize: (direction: 1 | -1) => void;
}

interface Stat {
  label: string;
  value: (view: RunView) => number | null;
  format: (value: number) => string;
  /** Which way is better, if either: the better value is marked. */
  better?: "lower" | "higher";
}

const STATS: Stat[] = [
  { label: "Iterations", value: (v) => v.result?.iterations ?? null, format: String, better: "lower" },
  { label: "Time", value: (v) => v.result?.duration_ms ?? null, format: (ms) => `${(ms / 1000).toFixed(1)} s`, better: "lower" },
  { label: "Cost", value: (v) => v.result?.estimated_cost_usd ?? null, format: (c) => `$${c.toFixed(4)}`, better: "lower" },
  { label: "Prompt tokens", value: (v) => (v.result ? promptTokens(v.usage) : null), format: kTokens, better: "lower" },
  { label: "Output tokens", value: (v) => v.result?.usage.output_tokens ?? null, format: kTokens, better: "lower" },
  { label: "Cache hit", value: (v) => (v.result ? cacheHitRate(v.usage) : null), format: (r) => `${Math.round(r * 100)}%`, better: "higher" },
  { label: "Peak context", value: (v) => (v.result ? v.peakContextTokens : null), format: kTokens, better: "lower" },
  { label: "Clears", value: (v) => (v.result ? v.clears.length : null), format: String },
];

function statusOf(view: RunView): string {
  if (view.phase === "running") return "running…";
  if (view.phase === "stopping") return "stopping…";
  if (view.phase === "failed") return "couldn't run";
  if (view.result) return view.result.status.replace(/_/g, " ");
  return "not run";
}

export function CompareView({ face, views, presets, onBack, textSize, onTextSize }: Props) {
  const faces = { A: settingsForSlot(face, "A"), B: settingsForSlot(face, "B") };
  const diff = diffSettings(agentSettingsOf(faces.A), agentSettingsOf(faces.B));
  const both = views.A.result && views.B.result;

  const presetLabel = (slot: Slot) => {
    const ref = presetRef(faces[slot], presets);
    return ref ? `${ref.name}${ref.modified ? " (edited)" : ""}` : "no preset";
  };

  return (
    <section className="panel compare" style={{ "--pane-text": `${textSize}px` } as React.CSSProperties}>
      <h2>
        A/B COMPARE
        <div className="pane-tools">
          <button className="pane-button" onClick={() => onTextSize(-1)} title="Smaller text (⌘−)" aria-label="Smaller text">A−</button>
          <span className="pane-size" aria-live="polite">{textSize}</span>
          <button className="pane-button" onClick={() => onTextSize(1)} title="Larger text (⌘+)" aria-label="Larger text">A+</button>
          <button className="pane-button" onClick={onBack} title="Back to the plugin (Esc)">Back to plugin</button>
        </div>
      </h2>
      <p className="compare-question">
        <span className="caps muted">SAME PROMPT, SAME DATA, TWO SETTINGS</span>
        <span className="quote">“{face.prompt.trim()}”</span>
      </p>

      <div className="compare-grid">
        <div className="compare-settings">
          <span className="caps muted">WHAT'S DIFFERENT</span>
          {diff.length ? (
            <table>
              <thead><tr><th /><th>A</th><th>B</th></tr></thead>
              <tbody>
                {diff.map((d) => (
                  <tr key={d.key}><th>{d.label}</th><td>{d.a}</td><td>{d.b}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="small muted">A and B have the same settings. Differences come down to the model's own variation.</p>
          )}
        </div>

        <div className="compare-stats">
          <table>
            <thead>
              <tr><th /><th>A · {presetLabel("A")}</th><th>B · {presetLabel("B")}</th></tr>
            </thead>
            <tbody>
              <tr><th>Status</th><td>{statusOf(views.A)}</td><td>{statusOf(views.B)}</td></tr>
              {STATS.map((stat) => {
                const a = stat.value(views.A);
                const b = stat.value(views.B);
                const winner = both && stat.better && a !== null && b !== null && a !== b
                  ? (a < b) === (stat.better === "lower") ? "A" : "B"
                  : null;
                return (
                  <tr key={stat.label}>
                    <th>{stat.label}</th>
                    <td className={winner === "A" ? `better ${stat.better}` : ""}>{a === null ? "—" : stat.format(a)}</td>
                    <td className={winner === "B" ? `better ${stat.better}` : ""}>{b === null ? "—" : stat.format(b)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="compare-answers">
        {(["A", "B"] as Slot[]).map((slot) => {
          const result = views[slot].result;
          return (
            <div key={slot} className="compare-answer">
              <span className="slot-badge">{slot}</span>
              <div className="answer-well">
                {!result && <p className="faint">{views[slot].phase === "failed" ? views[slot].error : statusOf(views[slot])}</p>}
                {result && (isAnswer(result.answer)
                  ? <StructuredAnswer answer={result.answer} />
                  : result.text ? <Markdown text={result.text} /> : <p className="faint">{result.error ?? "No answer."}</p>)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
