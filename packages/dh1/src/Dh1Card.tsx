// DH-1's compact rack card: the strip, a tile per section (SOURCE, COMPRESSOR, LIMITS,
// OUTPUT, each with its current value), and the essentials (preset, model, EFFORT, cost,
// iteration lights). A tile opens the full editor in the rack's top panel at that section.
// It's a view of the same model the editor draws (useDh1).

import { DeviceStrip, RackCard, SteppedKnob, Tile } from "@dh/ui-kit";
import type { Effort } from "./harness";
import { DEFAULT_SETTINGS, MODELS, type FaceSettings } from "./settings";
import type { Dh1Model } from "./useDh1";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** A section of DH-1's editor a tile opens (its panel's class in the face). */
export type Dh1Section = "source" | "agent" | "compressor" | "meters";

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** SOURCE in a few characters: what the agent will query. */
export function sourceSummary(s: FaceSettings): string {
  switch (s.sourceKind) {
    case "tpch":
      return `TPC-H ${s.tpchScale}`;
    case "db":
      return s.dbPath.trim() ? fileName(s.dbPath.trim()) : "no file yet";
    case "files":
      return s.files.length === 0 ? "no files yet" : s.files.length === 1 ? fileName(s.files[0]) : `${s.files.length} files`;
  }
}

export function Dh1Card({ model, collapsed, onToggleCollapse, onOpen, cardProps }: {
  model: Dh1Model;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Open the editor, at a section when a tile was clicked. */
  onOpen: (section?: Dh1Section) => void;
  /** Selection and the right-click menu, from the rack. */
  cardProps?: { selected: boolean; onSelect: () => void; onContextMenu: (e: React.MouseEvent) => void };
}) {
  const { settings, update, presets, view, server, priced, setlist } = model;
  const effortIndex = Math.max(0, EFFORTS.indexOf(settings.effort));
  const cost = view.costUsd == null ? (priced ? "$0.0000" : "n/a") : `$${view.costUsd.toFixed(4)}`;
  const lit = Math.min(view.iteration, settings.maxIterations);
  const leds = Math.min(settings.maxIterations, 12);
  return (
    <RackCard
      className="dh1-card"
      collapsed={collapsed}
      {...cardProps}
      strip={<DeviceStrip name="DH-1" status={server} collapsed={collapsed} onToggleCollapse={onToggleCollapse}
        onOpen={() => onOpen()} live={model.busy || setlist.busy} />}
      tiles={<>
        <Tile label="SOURCE" value={sourceSummary(settings)} onClick={() => onOpen("source")} />
        <Tile label="COMPRESSOR" value={settings.contextEditing ? `ON · ${k(settings.contextTriggerTokens)}` : "OFF"} onClick={() => onOpen("compressor")} />
        <Tile label="LIMITS" value={`${settings.maxIterations} it · ${settings.queryTimeoutSeconds} s`} onClick={() => onOpen("agent")} />
        <Tile label="OUTPUT" value={`${settings.maxResultRows} rows · ${k(settings.maxTokens)}`} onClick={() => onOpen("agent")} />
      </>}
    >
      <div className="card-preset">
        <button className="card-step" aria-label="Previous preset" onClick={() => presets.step(-1)}>‹</button>
        <button className="card-preset-name" onClick={() => onOpen()} title={presets.current?.name ?? "No preset"}>
          {presets.current?.name ?? "No preset"}{presets.modified ? " *" : ""}
        </button>
        <button className="card-step" aria-label="Next preset" onClick={() => presets.step(1)}>›</button>
      </div>
      <div className="segmented card-models" role="radiogroup" aria-label="Model">
        {MODELS.map((m) => (
          <button key={m.id} role="radio" aria-checked={settings.model === m.id} className={settings.model === m.id ? "on" : ""}
            title={m.label} onClick={() => update({ model: m.id })}>{m.label[0]}</button>
        ))}
      </div>
      <div className="card-knob">
        <SteppedKnob
          label="EFFORT"
          size="medium"
          values={EFFORTS.map((_, i) => i)}
          value={effortIndex}
          defaultValue={EFFORTS.indexOf(model.hello?.defaults.effort ?? DEFAULT_SETTINGS.effort)}
          format={(i) => EFFORTS[i].toUpperCase()}
          onChange={(i) => update({ effort: EFFORTS[i] })}
        />
      </div>
      <div className="card-meter">
        <span className="card-cost" title={priced ? "Estimated cost of the last run" : "No pricing for this model yet"}>{cost}</span>
        <span className="card-leds" aria-label={`Iteration ${view.iteration} of ${settings.maxIterations}`}>
          {Array.from({ length: leds }, (_, i) => <i key={i} className={i < Math.round((lit / settings.maxIterations) * leds) ? "on" : ""} />)}
        </span>
      </div>
    </RackCard>
  );
}
