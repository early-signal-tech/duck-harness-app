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
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
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
  const [pointerX1, pointerY1] = polar(radius * 0.26, angle);
  const [pointerX2, pointerY2] = polar(radius + 0.5, angle);
  const [capX, capY] = polar(radius * 0.6, angle);
  const size = (radius + 74) * 2;
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
          <defs>
            <radialGradient id={id} cx="42%" cy="36%" r="70%">
              <stop offset="0" stopColor="#f4f4f2" />
              <stop offset=".55" stopColor="#c4c4c2" />
              <stop offset="1" stopColor="#8a8a88" />
            </radialGradient>
          </defs>
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
          <circle r={radius + 1} fill="#0d0d0d" />
          {Array.from({ length: 12 }, (_, i) => {
            const [x1, y1] = polar(radius * 0.72, i * 30);
            const [x2, y2] = polar(radius + 1, i * 30);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2c2c2c" strokeWidth="1.5" />;
          })}
          <circle r={radius * 0.62} fill={`url(#${id})`} stroke="#111" />
          <line x1={pointerX1} y1={pointerY1} x2={pointerX2} y2={pointerY2} stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
          <line x1={pointerX1} y1={pointerY1} x2={capX} y2={capY} stroke="#111" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
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
}

/** `disabled` on an option is why it can't be chosen yet. */
export function BatToggle<T extends string>({ label, options, value, onChange }: ToggleProps<T>) {
  const at = options.findIndex((o) => o.value === value);
  const lean = options.length > 1 ? -18 + (36 * at) / (options.length - 1) : 0;
  const [tipX, tipY] = polar(18, lean);
  return (
    <div className="es1-toggle" role="radiogroup" aria-label={label}>
      <svg width="44" height="44" viewBox="-22 -26 44 44" aria-hidden="true">
        <circle r="10" fill="#d9d9d7" stroke="#111" />
        <circle r="6.5" fill="#6e6e6c" stroke="#222" />
        <line x1="0" y1="0" x2={tipX} y2={tipY} stroke="#d7d7d5" strokeWidth="6" strokeLinecap="round" />
      </svg>
      <div className="es1-options">
        {options.map((o) => (
          <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : ""}
            disabled={!!o.disabled} title={o.disabled} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      <span className="es1-lab">{label}</span>
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

function JackIcon() {
  return (
    <svg width="34" height="34" viewBox="-17 -17 34 34" aria-hidden="true">
      <polygon points="0,-15 13,-7.5 13,7.5 0,15 -13,7.5 -13,-7.5" fill="#cfcfcd" stroke="#111" />
      <circle r="8.5" fill="#8c8c8a" stroke="#222" />
      <circle r="5" fill="#050505" />
    </svg>
  );
}
