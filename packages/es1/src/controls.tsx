// The panel's controls: a skirted metal knob that clicks between stops, and a bat-handle
// toggle. Both draw their stops, because on this panel the control is the readout.

import { valueFromDrag } from "@dh/ui-kit";
import { useId, useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";

const SWEEP = 270;
const START = -135;
const polar = (r: number, degrees: number): [number, number] => {
  const a = (degrees * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
};

/** Which stop the pointer sits on. One stop points straight up. */
const angleOf = (i: number, stops: number) => (stops > 1 ? START + (SWEEP * i) / (stops - 1) : 0);

interface KnobProps {
  label: string;
  /** The flag or spec field it sets, printed under it. */
  spec?: string;
  stops: readonly string[];
  value: number;
  onChange?: (value: number) => void;
  /** Print what each stop is around the dial, for short lists. */
  labelled?: boolean;
  radius?: number;
  disabled?: boolean;
  /** What it's set to, printed under it. */
  readout?: string;
}

export function StopKnob({ label, spec, stops, value, onChange, labelled, radius = 25, disabled, readout }: KnobProps) {
  const drag = useRef<{ y: number; value: number } | null>(null);
  const last = stops.length - 1;
  const inert = disabled || last < 1 || !onChange;
  const set = (next: number) => {
    const clamped = Math.max(0, Math.min(last, next));
    if (!inert && clamped !== value) onChange(clamped);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || inert) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { y: e.clientY, value };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) set(valueFromDrag(drag.current.value, drag.current.y - e.clientY, 0, last, 1, e.shiftKey));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0) set(value + (e.deltaY < 0 ? 1 : -1));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowUp: value + 1, ArrowRight: value + 1, ArrowDown: value - 1, ArrowLeft: value - 1, Home: 0, End: last };
    if (e.key in moves) {
      e.preventDefault();
      set(moves[e.key]);
    }
  };

  const ticks = Math.max(stops.length, labelled ? 0 : 5);
  const angle = angleOf(value, stops.length);
  const size = (radius + 74) * 2;
  const body = radius * 2 + 2;
  return (
    <div className={`es1-knob${disabled ? " disabled" : ""}`}>
      <div
        className="es1-dial"
        style={{ width: radius * 2 + 4, height: radius * 2 + 4 }}
        role="slider"
        tabIndex={inert ? -1 : 0}
        aria-label={label}
        aria-disabled={inert || undefined}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={value}
        aria-valuetext={stops[value]}
        title={inert ? undefined : `${label}: ${stops[value]}. Drag, scroll, or use the arrow keys.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden="true">
          {Array.from({ length: ticks }, (_, i) => {
            const a = angleOf(i, ticks);
            const [x1, y1] = polar(radius + 4, a);
            const [x2, y2] = polar(radius + 10, a);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="es1-tick" />;
          })}
          {labelled && stops.map((stop, i) => {
            const a = angleOf(i, stops.length);
            const [x, y] = polar(radius + 14, a);
            return (
              <text key={stop} x={x} y={y + 3} className={`es1-stop${i === value ? " on" : ""}`}
                textAnchor={Math.abs(a) < 25 ? "middle" : a > 0 ? "start" : "end"}>{stop}</text>
            );
          })}
        </svg>
        {/* The knob itself, in layers: the skirt's shading and the cap's sheen stay put, because
            the light doesn't move; only the grooves and the pointer turn. */}
        <span className="es1-knob-body" style={{ width: body, height: body }} aria-hidden="true">
          <span className="es1-knob-cap" style={{ width: radius * 1.24, height: radius * 1.24 }} />
          <svg className="es1-knob-turn" width={body} height={body} viewBox={`${-body / 2} ${-body / 2} ${body} ${body}`}
            style={{ transform: `rotate(${angle}deg)` }}>
            {Array.from({ length: 36 }, (_, i) => {
              const [x1, y1] = polar(radius * 0.7, i * 10);
              const [x2, y2] = polar(radius + 0.5, i * 10);
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={i % 2 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.55)"} strokeWidth="1.1" />;
            })}
            <line x1="0" y1={-radius * 0.66} x2="0" y2={-radius + 1} stroke="#f4f4f0" strokeWidth="2.6" strokeLinecap="round" />
            <line x1="0" y1={-radius * 0.22} x2="0" y2={-radius * 0.56} stroke="#1a1a19" strokeWidth="2.4" strokeLinecap="round" />
            <line x1="0.9" y1={-radius * 0.22} x2="0.9" y2={-radius * 0.56} stroke="rgba(255,255,255,0.55)" strokeWidth="0.6" />
          </svg>
        </span>
      </div>
      <span className="es1-lab">{label}</span>
      {spec && <span className="es1-spec">{spec}</span>}
      {readout && <span className="es1-spec es1-readout" title={readout}>{readout}</span>}
    </div>
  );
}

interface ToggleProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string; disabled?: string }[];
  value: T;
  onChange: (value: T) => void;
  /** The field it sets, printed under it. */
  spec?: string;
  spec2?: string;
  /** Doesn't apply here: printed dim, and can't be moved. */
  disabled?: boolean;
}

/** `disabled` on an option is why it can't be chosen yet. */
export function BatToggle<T extends string>({ label, options, value, onChange, spec, spec2, disabled }: ToggleProps<T>) {
  const at = options.findIndex((o) => o.value === value);
  const lean = options.length > 1 ? -18 + (36 * at) / (options.length - 1) : 0;
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  // A chrome bat handle on a hex nut. Drawn pointing up, then leaned.
  const bat = "M-1.6 0 L-2.9 -13.6 A3.5 3.5 0 1 1 2.9 -13.6 L1.6 0 Z";
  return (
    <div className={`es1-toggle${disabled ? " disabled" : ""}`} role="radiogroup" aria-label={label || options.map((o) => o.label).join(" or ")}>
      <svg width="44" height="44" viewBox="-22 -26 44 44" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}n`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f6f6f4" /><stop offset=".5" stopColor="#bdbdba" /><stop offset="1" stopColor="#6d6d6a" />
          </linearGradient>
          <radialGradient id={`${id}b`} cx="40%" cy="35%" r="70%">
            <stop offset="0" stopColor="#9a9a97" /><stop offset="1" stopColor="#232322" />
          </radialGradient>
          <linearGradient id={`${id}h`} gradientUnits="userSpaceOnUse" x1="-3.6" y1="0" x2="3.6" y2="0">
            <stop offset="0" stopColor="#5e5e5b" /><stop offset=".3" stopColor="#fbfbf9" /><stop offset=".55" stopColor="#d2d2cf" /><stop offset="1" stopColor="#545452" />
          </linearGradient>
          <filter id={`${id}s`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.3" /></filter>
        </defs>
        <polygon points="0,-11 9.5,-5.5 9.5,5.5 0,11 -9.5,5.5 -9.5,-5.5" fill="rgba(0,0,0,0.4)" transform="translate(0 2)" filter={`url(#${id}s)`} />
        <polygon points="0,-11 9.5,-5.5 9.5,5.5 0,11 -9.5,5.5 -9.5,-5.5" fill={`url(#${id}n)`} stroke="#3b3b39" strokeWidth=".6" />
        <circle r="6.4" fill={`url(#${id}b)`} stroke="#151514" strokeWidth=".8" />
        <g className="es1-bat-shadow" style={{ transform: `translate(1px, 3px) rotate(${lean}deg)` }}>
          <path d={bat} fill="rgba(0,0,0,0.45)" filter={`url(#${id}s)`} />
        </g>
        <g className="es1-bat" style={{ transform: `rotate(${lean}deg)` }}>
          <path d={bat} fill={`url(#${id}h)`} stroke="#3a3a38" strokeWidth=".5" />
          <ellipse cx="-1" cy="-15.6" rx="1.1" ry="1.6" fill="rgba(255,255,255,0.85)" />
        </g>
      </svg>
      <div className="es1-options">
        {options.map((o) => (
          <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : ""}
            disabled={disabled || !!o.disabled} title={o.disabled} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {label && <span className="es1-lab">{label}</span>}
      {spec && <span className="es1-spec">{spec}</span>}
      {spec2 && <span className="es1-spec">{spec2}</span>}
    </div>
  );
}

/** A socket on a module's top edge. It's printed on the panel; nothing plugs into it in MAP. */
export function Jack({ label, out }: { label: string; out?: boolean }) {
  return (
    <span className={`es1-jack${out ? " out" : ""}`}>
      {!out && <JackIcon />}
      <span className="es1-jack-label">{label}</span>
      {out && <JackIcon />}
    </span>
  );
}

/** A threaded socket: a hex nut, a collar, and a hole deep enough to be dark. */
function JackIcon() {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg width="34" height="34" viewBox="-17 -17 34 34" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}n`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7f7f5" /><stop offset=".5" stopColor="#c2c2bf" /><stop offset="1" stopColor="#737370" />
        </linearGradient>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6c6c69" /><stop offset="1" stopColor="#d9d9d6" />
        </linearGradient>
        <radialGradient id={`${id}h`} cx="50%" cy="58%" r="55%">
          <stop offset="0" stopColor="#000" /><stop offset=".75" stopColor="#0b0b0b" /><stop offset="1" stopColor="#3a3a38" />
        </radialGradient>
      </defs>
      <polygon points="0,-14 12,-7 12,7 0,14 -12,7 -12,-7" fill="rgba(0,0,0,0.35)" transform="translate(0 1.6)" />
      <polygon points="0,-14 12,-7 12,7 0,14 -12,7 -12,-7" fill={`url(#${id}n)`} stroke="#3b3b39" strokeWidth=".7" />
      <circle r="8.6" fill={`url(#${id}c)`} stroke="#2b2b29" strokeWidth=".7" />
      <circle r="5.4" fill={`url(#${id}h)`} />
    </svg>
  );
}
