// One device in the rack: a title bar (fold, the engine light, the device's name, the
// device's own controls, FULL FACE) above the device itself. Folded, it's a narrow
// vertical strip; the device stays mounted, so a run or a grading keeps going.

import { useState, type ReactNode } from "react";
import type { EngineStatus } from "@dh/ui-kit";

interface Props {
  /** The device's name in the host: "dh1" or "eh1" (data-device, for keyboard scoping). */
  device: string;
  name: string;
  tagline: string;
  status: EngineStatus;
  folded: boolean;
  /** This device fills the rack; the others are hidden (still running). */
  full: boolean;
  /** Another device fills the rack. */
  hidden: boolean;
  onFold: (folded: boolean) => void;
  onFull: (full: boolean) => void;
  /** The device, given the title bar's slot for its own controls (null while folded). */
  children: (toolbar: HTMLElement | null) => ReactNode;
}

const STATUS = { ready: "running", connecting: "starting", down: "offline" } as const;

export function DeviceFrame({ device, name, tagline, status, folded, full, hidden, onFold, onFull, children }: Props) {
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const light = <span className={`engine ${status}`} title={`${name} engine: ${STATUS[status]}`}><span className="dot" aria-hidden="true" /></span>;
  const classes = ["device-frame", device, folded && "folded", full && "full", hidden && "behind"].filter(Boolean).join(" ");
  return (
    <section data-device={device} className={classes} aria-label={`${name} device`}>
      {folded ? (
        <div className="device-strip">
          <button className="bar-button" onClick={() => onFold(false)} aria-label={`Unfold ${name}`} title={`Unfold ${name}`}>▸</button>
          {light}
          <span className="device-strip-name">{name} · {tagline}</span>
        </div>
      ) : (
        <header className="bar device-bar">
          {!full && (
            <button className="bar-button" onClick={() => onFold(true)} aria-label={`Fold ${name}`} title={`Fold ${name} (it keeps running)`}>◂</button>
          )}
          {light}
          <div className="brand">
            <span className="wordmark">{name}</span>
            <span className="tagline">{tagline}</span>
          </div>
          <div className="host-slot" ref={setToolbar} />
          <div className="spacer" />
          <button className="bar-button" onClick={() => onFull(!full)} title={full ? "Back to the whole rack" : `Give ${name} the whole window`}>
            {full ? "BACK TO RACK" : "FULL FACE ⤢"}
          </button>
        </header>
      )}
      <div className="device-body">{children(folded ? null : toolbar)}</div>
    </section>
  );
}
