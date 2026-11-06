// The rack's transport, across the top like a DAW's: the prompt, what PLAY makes (a RUN,
// an A/B, or a SETLIST), PLAY and STOP, then Settings and the engine lights. It drives
// DH-1's model, so it works whichever device is open in the panel. While a setlist plays,
// the prompt gives way to its progress.

import { progressOf, type Dh1Model } from "@dh/dh1";
import type { EngineStatus } from "@dh/ui-kit";
import type { ReactNode } from "react";
import type { Take } from "./rackLayout";

const TAKES: { value: Take; label: string; hint: string }[] = [
  { value: "run", label: "RUN", hint: "One run of the prompt" },
  { value: "ab", label: "A/B", hint: "The prompt on A and B at once" },
  { value: "setlist", label: "SETLIST", hint: "A question set × presets: set it up in DH-1's Setlist" },
];

export function Transport({ dh1, playable, take, onTake, onPlay, settings, lights }: {
  dh1: Dh1Model;
  /** The chain has DH-1 to play; without it, PLAY says what's missing. */
  playable: boolean;
  take: Take;
  onTake: (take: Take) => void;
  /** PLAY: run, run A+B, or open DH-1's Setlist to set one up and start it. */
  onPlay: () => void;
  settings: ReactNode;
  lights: { label: string; status: EngineStatus; error?: string | null }[];
}) {
  const { settings: face, update, setlist, canRun, canRunBoth, problem, anyBusy, stop } = dh1;
  const playing = setlist.busy;
  const progress = progressOf(setlist.state);
  const canPlay = playable && (take === "run" ? canRun : take === "ab" ? canRunBoth : !anyBusy && !playing && dh1.server === "ready");
  const playTitle = !playable ? "Add DH-1 to the chain (+ in the rack) to play" : take === "setlist"
    ? "Open DH-1's Setlist to pick the questions and presets, then START"
    : problem ?? (take === "ab" ? "Run A and B at once (↵)" : "Run (↵)");
  return (
    <header className="bar transport">
      <div className="brand">
        <span className="wordmark">RACK</span>
        <span className="tagline">DUCK HARNESS</span>
      </div>
      {playing ? (
        <div className="transport-playing" role="status">
          <span className="playing-dot" aria-hidden="true" />
          <span>SETLIST</span>
          <span className="mono">{progress.settled} / {progress.total} · ${progress.spent.toFixed(4)}</span>
          <span className="transport-progress"><i style={{ width: `${progress.total ? (progress.settled / progress.total) * 100 : 0}%` }} /></span>
        </div>
      ) : (
        <>
          <label className="caps transport-label" htmlFor="transport-prompt">PROMPT</label>
          <input
            id="transport-prompt"
            className="transport-prompt"
            value={face.prompt}
            spellCheck
            placeholder={take === "setlist" ? "A setlist plays its own questions" : "Ask a question about your data…"}
            disabled={take === "setlist" || !playable}
            onChange={(e) => update({ prompt: e.currentTarget.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (canPlay) onPlay();
              }
            }}
          />
        </>
      )}
      <div className="bar-group transport-take" role="radiogroup" aria-label="What PLAY makes">
        {TAKES.map((t) => (
          <button key={t.value} role="radio" aria-checked={take === t.value} className={take === t.value ? "on" : ""}
            title={t.hint} disabled={playing} onClick={() => onTake(t.value)}>{t.label}</button>
        ))}
      </div>
      <button className="transport-play" disabled={!canPlay} onClick={onPlay} title={playTitle}>▶ PLAY</button>
      <button className="transport-stop" disabled={!anyBusy && !playing} onClick={() => (playing ? setlist.stop() : stop())} title="Stop">
        ■ STOP
      </button>
      <span className="transport-divider" aria-hidden="true" />
      {settings}
      {lights.map((l) => (
        <div key={l.label} className={`engine ${l.status}`} title={l.error ?? `${l.label} engine: ${l.status}`}>
          <span className="dot" aria-hidden="true" />
          {l.label}
        </div>
      ))}
    </header>
  );
}
