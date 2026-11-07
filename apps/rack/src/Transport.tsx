// The rack's transport, across the top like a DAW's: the prompt, what PLAY makes (a RUN,
// an A/B, or a SETLIST), PLAY and STOP, then Settings and the engine lights. It drives
// DH-1's model, so it works whichever device is open in the panel. In SETLIST mode the
// prompt gives way to the setlist that PLAY will start (Edit… opens DH-1's Setlist to
// change it); while one plays, to its progress.

import { progressOf, type Dh1Model } from "@dh/dh1";
import type { EngineStatus } from "@dh/ui-kit";
import type { ReactNode } from "react";
import type { Take } from "./rackLayout";

const TAKES: { value: Take; label: string; hint: string }[] = [
  { value: "run", label: "RUN", hint: "One run of the prompt" },
  { value: "ab", label: "A/B", hint: "The prompt on A and B at once" },
  { value: "setlist", label: "SETLIST", hint: "A question set × presets × repeats" },
];

export function Transport({ dh1, playable, take, onTake, onPlay, onEditSetlist, settings, lights, presets }: {
  dh1: Dh1Model;
  /** Open DH-1's Setlist, to change what SETLIST plays. */
  onEditSetlist: () => void;
  /** The rack's preset bar (‹ name ▾ ›), after the name. */
  presets?: ReactNode;
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
  const draft = dh1.setlistDraft;
  const canPlay = playable && (take === "run" ? canRun : take === "ab" ? canRunBoth : dh1.setlistProblem === null);
  const playTitle = !playable ? "Add DH-1 to the chain (+ in the rack) to play" : take === "setlist"
    ? dh1.setlistProblem ?? `Play the setlist: ${draft.runs} runs, ${draft.saved.concurrency} at a time`
    : problem ?? (take === "ab" ? "Run A and B at once (↵)" : "Run (↵)");
  return (
    <header className="bar transport">
      <div className="brand">
        <span className="wordmark">RACK</span>
        <span className="tagline">DUCK HARNESS</span>
      </div>
      {presets}
      {playing ? (
        <div className="transport-playing" role="status">
          <span className="playing-dot" aria-hidden="true" />
          <span>SETLIST</span>
          <span className="mono">{progress.settled} / {progress.total} · ${progress.spent.toFixed(4)}</span>
          <span className="transport-progress"><i style={{ width: `${progress.total ? (progress.settled / progress.total) * 100 : 0}%` }} /></span>
        </div>
      ) : take === "setlist" ? (
        <div className="transport-setlist" title="What PLAY starts: change it in DH-1's Setlist">
          <span className="caps transport-label">SETLIST</span>
          <span className="transport-setlist-what">
            {draft.set.name} · {draft.set.questions.length} questions × {draft.columns.length} preset{draft.columns.length === 1 ? "" : "s"} × {draft.saved.repeats}
          </span>
          <span className="mono transport-setlist-runs">{draft.runs} runs</span>
          <button className="bar-button" onClick={onEditSetlist}>Edit…</button>
        </div>
      ) : (
        <>
          <label className="caps transport-label" htmlFor="transport-prompt">PROMPT</label>
          <input
            id="transport-prompt"
            className="transport-prompt"
            value={face.prompt}
            spellCheck
            placeholder="Ask a question about your data…"
            disabled={!playable}
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
