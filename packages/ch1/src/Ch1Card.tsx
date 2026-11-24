// CH-1's rack card: the strip, DATA / CONVERSATION / HISTORY tiles, and the essentials:
// the DH-1 preset it plays, EFFORT, and the open conversation's cost. The host owns the
// preset and EFFORT (they're what a question runs with); the rest comes from useChat.

import type { Effort } from "@dh/dh1";
import { DeviceStrip, RackCard, SteppedKnob, Tile, type EngineStatus } from "@dh/ui-kit";
import { describeData, money } from "./chat";
import type { ChatModel } from "./useChat";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function Ch1Card({ model, status, preset, effort, onEffort, collapsed, onToggleCollapse, onOpen, cardProps }: {
  model: ChatModel;
  status?: EngineStatus;
  /** The DH-1 preset CH-1 plays, and stepping through the presets. */
  preset: { name: string; edited?: boolean; onStep: (delta: number) => void; onOpen?: () => void };
  effort: Effort;
  onEffort: (effort: Effort) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Open CH-1's panel. */
  onOpen: () => void;
  cardProps?: { selected: boolean; onSelect: () => void; onContextMenu: (e: React.MouseEvent) => void };
}) {
  const { current, asked, maxTurns } = model;
  const conversation = asked === 0 && current.rootRunId === null ? "new" : `${asked} of ${maxTurns}`;
  return (
    <RackCard
      className="ch1-card"
      collapsed={collapsed}
      {...cardProps}
      strip={<DeviceStrip name="CH-1" status={status} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onOpen={onOpen} live={model.busy} />}
      tiles={<>
        <Tile label="DATA" value={describeData(current.source)} onClick={onOpen} title="The data the next question runs on" />
        <Tile label="CONVERSATION" value={conversation} onClick={onOpen} title="Questions asked in the open conversation" />
        <Tile label="HISTORY" value={`${model.conversations.length} saved`} onClick={onOpen} title="Conversations in this rack preset, from the traces" />
      </>}
    >
      <span className="ch1-card-label">PLAYS DH-1 PRESET</span>
      <div className="card-preset">
        <button className="card-step" aria-label="Previous preset" onClick={() => preset.onStep(-1)}>‹</button>
        <button className="card-preset-name" onClick={preset.onOpen ?? onOpen} title={`${preset.name}${preset.edited ? " (edited)" : ""}`}>
          <span className="card-preset-text">{preset.name}</span>
          {preset.edited && <span className="card-edited" aria-label="edited">●</span>}
        </button>
        <button className="card-step" aria-label="Next preset" onClick={() => preset.onStep(1)}>›</button>
      </div>
      <div className="card-knob">
        <SteppedKnob
          label="EFFORT"
          size="medium"
          values={EFFORTS.map((_, i) => i)}
          value={Math.max(0, EFFORTS.indexOf(effort))}
          defaultValue={EFFORTS.indexOf("medium")}
          format={(i) => EFFORTS[i].toUpperCase()}
          onChange={(i) => onEffort(EFFORTS[i])}
        />
      </div>
      <div className="card-meter">
        <span className="card-cost" title="The open conversation's estimated cost">{money(model.costUsd)}</span>
      </div>
    </RackCard>
  );
}
