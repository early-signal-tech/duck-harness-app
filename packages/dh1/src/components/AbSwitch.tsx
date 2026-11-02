// A | B in the header bar, as on the wireframe: flip between two sets of settings,
// copy one over the other, and open the side-by-side comparison.

import { otherSlot, type Slot } from "../ab";
import type { Phase } from "../runState";

interface Props {
  slot: Slot;
  phases: Record<Slot, Phase>;
  onSwitch: () => void;
  onCopy: () => void;
  canCompare: boolean;
  onCompare: () => void;
}

const lamp = (phase: Phase) => (phase === "running" || phase === "stopping" ? "busy" : phase === "done" ? "done" : "");

export function AbSwitch({ slot, phases, onSwitch, onCopy, canCompare, onCompare }: Props) {
  return (
    <div className="bar-group ab">
      <div className="ab-slots" role="radiogroup" aria-label="A/B slot">
        {(["A", "B"] as Slot[]).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={slot === s}
            className={slot === s ? "on" : ""}
            onClick={() => slot !== s && onSwitch()}
            title={`Settings ${s}${phases[s] === "running" ? " · running" : phases[s] === "done" ? " · has a result" : ""}`}
          >
            {s}
            <span className={`ab-lamp ${lamp(phases[s])}`} aria-hidden="true" />
          </button>
        ))}
      </div>
      <button className="bar-button ab-copy" onClick={onCopy} title={`Copy ${slot}'s settings over ${otherSlot(slot)}`}>
        {slot} → {otherSlot(slot)}
      </button>
      <button className="bar-button ab-compare" disabled={!canCompare} onClick={onCompare} title={canCompare ? "Compare A and B side by side" : "Run both A and B to compare them"}>
        Compare
      </button>
    </div>
  );
}
