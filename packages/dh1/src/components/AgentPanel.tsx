// AGENT: the model switch, STRUCTURED and CACHE, and the five knobs from the wireframe:
// EFFORT, ITERATIONS, RESULT SIZE (rows, with chars and cell clip in a flyout), TIMEOUT,
// and MAX TOKENS.

import { Knob, Menu, MenuSection, SteppedKnob, Toggle } from "@dh/ui-kit";
import { useState } from "react";
import type { Effort, Hello } from "../harness";
import { DEFAULT_SETTINGS, MODELS, type FaceSettings } from "../settings";
import { kTokens } from "./CompressorPanel";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const MAX_ITERATIONS = 50;
export const ROWS = [10, 25, 50, 100, 200, 500, 1000, 2000] as const;
export const CHARS = [5_000, 10_000, 20_000, 40_000, 80_000] as const;
export const CELL_CLIP = [100, 200, 500, 1000, 2000] as const;
export const TIMEOUTS = [5, 10, 15, 30, 60, 120, 300] as const;
const TOKEN_STEPS = [2_000, 4_000, 8_000, 12_000, 16_000, 20_000, 21_000];

const seconds = (s: number) => (s >= 60 ? `${s / 60} min` : `${s} s`);

interface Props {
  settings: FaceSettings;
  update: (patch: Partial<FaceSettings>) => void;
  hello: Hello | null;
  priced: boolean;
}

export function AgentPanel({ settings, update, hello, priced }: Props) {
  const [sizeOpen, setSizeOpen] = useState(false);
  const effortIndex = Math.max(0, EFFORTS.indexOf(settings.effort));
  // The largest max_tokens a non-streaming call allows (from the server; 21K today).
  const tokenLimit = hello?.limits?.max_tokens ?? 21_000;
  const tokenSteps = TOKEN_STEPS.filter((t) => t <= tokenLimit);

  return (
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
        <div className="spacer" />
        <Toggle
          label="STRUCTURED"
          on={settings.structuredAnswer}
          onChange={(structuredAnswer) => update({ structuredAnswer })}
          title="End with a structured answer: summary, key findings, caveats, and the SQL it rests on"
        />
        <Toggle
          label="CACHE"
          on={settings.promptCaching}
          onChange={(promptCaching) => update({ promptCaching })}
          title="Prompt caching: reuse the unchanged start of the conversation at a tenth of the price"
        />
      </div>

      <div className="knobs">
        <Knob
          label="EFFORT"
          value={effortIndex}
          min={0}
          max={EFFORTS.length - 1}
          defaultValue={EFFORTS.indexOf(hello?.defaults.effort ?? DEFAULT_SETTINGS.effort)}
          format={(i) => EFFORTS[i].toUpperCase()}
          hint="how hard Claude thinks"
          onChange={(i) => update({ effort: EFFORTS[i] })}
        />
        <Knob
          label="ITERATIONS"
          value={settings.maxIterations}
          min={1}
          max={MAX_ITERATIONS}
          defaultValue={hello?.defaults.max_iterations ?? DEFAULT_SETTINGS.maxIterations}
          format={(n) => String(n)}
          hint="tool rounds before wrap-up"
          onChange={(maxIterations) => update({ maxIterations })}
        />
        <div className="knob-with-flyout">
          <SteppedKnob
            label="RESULT SIZE"
            values={ROWS}
            value={settings.maxResultRows}
            defaultValue={DEFAULT_SETTINGS.maxResultRows}
            format={(n) => `${n} rows`}
            onChange={(maxResultRows) => update({ maxResultRows })}
          />
          <Menu
            open={sizeOpen}
            onClose={() => setSizeOpen(false)}
            label="Result size"
            anchor={
              <button className="flyout-link" onClick={() => setSizeOpen(!sizeOpen)} title="Characters and cell clip">
                <span className="long">{kTokens(settings.maxResultChars)} chars · clip {settings.maxCellChars} ›</span>
                <span className="short">more ›</span>
              </button>
            }
          >
            <MenuSection title="RESULT SIZE · WHAT CLAUDE SEES OF EACH QUERY">
              <div className="flyout-knobs">
                <SteppedKnob
                  size="small"
                  label="ROWS"
                  values={ROWS}
                  value={settings.maxResultRows}
                  defaultValue={DEFAULT_SETTINGS.maxResultRows}
                  format={String}
                  hint="per result"
                  onChange={(maxResultRows) => update({ maxResultRows })}
                />
                <SteppedKnob
                  size="small"
                  label="CHARS"
                  values={CHARS}
                  value={settings.maxResultChars}
                  defaultValue={DEFAULT_SETTINGS.maxResultChars}
                  format={kTokens}
                  hint="per result"
                  onChange={(maxResultChars) => update({ maxResultChars })}
                />
                <SteppedKnob
                  size="small"
                  label="CELL CLIP"
                  values={CELL_CLIP}
                  value={settings.maxCellChars}
                  defaultValue={DEFAULT_SETTINGS.maxCellChars}
                  format={String}
                  hint="chars per value"
                  onChange={(maxCellChars) => update({ maxCellChars })}
                />
              </div>
              <span className="menu-empty">
                Bigger results cost more on every later turn: each one stays in the conversation (until the
                compressor clears it).
              </span>
            </MenuSection>
          </Menu>
        </div>
        <SteppedKnob
          label="TIMEOUT"
          values={TIMEOUTS}
          value={settings.queryTimeoutSeconds}
          defaultValue={DEFAULT_SETTINGS.queryTimeoutSeconds}
          format={seconds}
          hint="per query"
          onChange={(queryTimeoutSeconds) => update({ queryTimeoutSeconds })}
        />
        <SteppedKnob
          label="MAX TOKENS"
          values={tokenSteps}
          value={settings.maxTokens}
          defaultValue={DEFAULT_SETTINGS.maxTokens}
          format={kTokens}
          hint="per response"
          onChange={(maxTokens) => update({ maxTokens })}
        />
      </div>

      <div className="panel-foot">
        <span className="small muted">
          {priced ? "Drag, scroll, or use arrow keys · double-click resets" : "No price table for this model yet, so cost reads n/a"}
        </span>
      </div>
    </section>
  );
}
