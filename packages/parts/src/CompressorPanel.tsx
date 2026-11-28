// CONTEXT COMPRESSOR: the agent's context editing, drawn as a compressor. Once the
// prompt passes the THRESHOLD, the API clears old tool results (keeping the last KEEP),
// but only when at least CLEAR ≥ tokens would be freed. GAIN REDUCTION shows how much
// the last clear took off. The sidechain lists tools whose results are never cleared.

import { Menu, MenuSection, SteppedKnob, Knob, Toggle } from "@dh/ui-kit";
import { useState } from "react";
import { DEFAULT_COMPRESSOR as DEFAULTS, kTokens, type CompressorReading, type CompressorSettings } from "./settings";

export const THRESHOLDS = [20_000, 40_000, 60_000, 80_000, 100_000, 120_000, 150_000] as const;
export const CLEAR_AT_LEAST = [0, 5_000, 10_000, 20_000, 30_000, 40_000, 60_000] as const;

/** Width of the CONTEXT IN meter, and where Haiku 5.5's long-prompt price begins. */
const CONTEXT_SCALE = 200_000;
const PRICE_KNEE = 100_000;
/** Gain reduction: 12 segments of 5K, up to a 60K clear. */
const GR_SEGMENTS = 12;
const GR_STEP = 5_000;

const TOOL_LABELS: Record<string, string> = {
  list_tables: "List tables",
  describe_table: "Describe table",
  sample_rows: "Sample rows",
  query_database: "Query database",
  submit_answer: "Submit answer",
};

interface Props {
  settings: CompressorSettings;
  update: (patch: Partial<CompressorSettings>) => void;
  view: CompressorReading;
  tools: string[];
}

export function CompressorPanel({ settings, update, view, tools }: Props) {
  const [sidechainOpen, setSidechainOpen] = useState(false);
  const on = settings.contextEditing;
  const idle = view.phase === "idle";
  const context = idle ? 0 : view.contextTokens;
  const lastClear = view.clears[view.clears.length - 1];
  const litSegments = lastClear ? Math.min(GR_SEGMENTS, Math.ceil(lastClear.tokens / GR_STEP)) : 0;
  const at = (tokens: number) => `${Math.min(100, (tokens / CONTEXT_SCALE) * 100)}%`;
  const protectedTools = settings.contextProtectedTools;
  // Submitting the answer ends the run, so protecting it would mean nothing.
  const choosable = tools.filter((t) => t !== "submit_answer");

  const toggleTool = (tool: string) =>
    update({
      contextProtectedTools: protectedTools.includes(tool)
        ? protectedTools.filter((t) => t !== tool)
        : [...protectedTools, tool],
    });

  return (
    <section className={`panel compressor dh-part${on ? "" : " off"}`}>
      <h2>
        CONTEXT COMPRESSOR
        <Toggle
          small
          label={on ? "ON" : "OFF"}
          on={on}
          onChange={(contextEditing) => update({ contextEditing })}
          title="Context editing: clear old tool results from long runs"
        />
      </h2>

      <div className="comp-knobs">
        <SteppedKnob
          size="medium"
          label="THRESHOLD"
          values={THRESHOLDS}
          value={settings.contextTriggerTokens}
          defaultValue={DEFAULTS.contextTriggerTokens}
          format={kTokens}
          disabled={!on}
          onChange={(contextTriggerTokens) => update({ contextTriggerTokens })}
        />
        <Knob
          size="medium"
          label="KEEP"
          min={0}
          max={20}
          value={settings.contextKeepToolUses}
          defaultValue={DEFAULTS.contextKeepToolUses}
          format={(n) => `${n} uses`}
          disabled={!on}
          onChange={(contextKeepToolUses) => update({ contextKeepToolUses })}
        />
        <SteppedKnob
          size="medium"
          label="CLEAR ≥"
          values={CLEAR_AT_LEAST}
          value={settings.contextClearAtLeastTokens}
          defaultValue={DEFAULTS.contextClearAtLeastTokens}
          format={kTokens}
          disabled={!on}
          onChange={(contextClearAtLeastTokens) => update({ contextClearAtLeastTokens })}
        />
      </div>

      <div className="comp-meter">
        <div className="caps muted row-between">
          <span>CONTEXT IN</span>
          <span>{kTokens(context)} / {kTokens(CONTEXT_SCALE)}</span>
        </div>
        <div className="context-bar" title="Prompt size of the latest API call">
          <div className="knee" style={{ left: at(PRICE_KNEE) }} title="Input price steps up past 100K tokens" />
          <div className="fill" style={{ width: at(context) }} />
          {!idle && view.peakContextTokens > context && <div className="peak" style={{ left: at(view.peakContextTokens) }} />}
          {on && <div className="threshold" style={{ left: at(settings.contextTriggerTokens) }} />}
        </div>
        <div className="threshold-label">
          {on && <span style={{ left: at(settings.contextTriggerTokens) }}>THR {kTokens(settings.contextTriggerTokens)}</span>}
        </div>
      </div>

      <div className="comp-meter">
        <div className="caps muted row-between">
          <span>GAIN REDUCTION</span>
          <span>
            {lastClear
              ? `last clear −${kTokens(lastClear.tokens)}${view.clears.length > 1 ? ` · ${view.clears.length} clears` : ""}`
              : idle ? "—" : "no clears"}
          </span>
        </div>
        <div className="gr" aria-label={lastClear ? `Last clear freed ${lastClear.tokens} tokens` : "No clears"}>
          {Array.from({ length: GR_SEGMENTS }, (_, i) => (
            <span key={i} className={i < litSegments ? "seg lit" : "seg"} />
          ))}
        </div>
        <div className="gr-scale"><span>−60K</span><span>−40K</span><span>−20K</span><span>0</span></div>
      </div>

      <Menu
        open={sidechainOpen}
        onClose={() => setSidechainOpen(false)}
        label="Sidechain"
        align="right"
        anchor={
          <button className="sidechain" onClick={() => setSidechainOpen(!sidechainOpen)} disabled={!on}>
            <span>Sidechain · never cleared: {protectedTools.length ? protectedTools.join(", ") : "none"}</span>
            <span aria-hidden="true">›</span>
          </button>
        }
      >
        <MenuSection title="SIDECHAIN · NEVER CLEAR">
          {choosable.map((tool) => (
            <label key={tool} className="menu-check-row sidechain-row">
              <input type="checkbox" checked={protectedTools.includes(tool)} onChange={() => toggleTool(tool)} />
              <span>{TOOL_LABELS[tool] ?? tool}</span>
              <code>{tool}</code>
            </label>
          ))}
          <span className="menu-empty">Results from these tools stay in the conversation for the whole run.</span>
        </MenuSection>
      </Menu>
    </section>
  );
}
