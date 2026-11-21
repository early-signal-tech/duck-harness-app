// PB-1's controls, drawn as in the wireframe: a knob that clicks between stops (with the
// stops printed round it, or its value in a window under it) and a slide switch. Knobs drag
// up and down (Shift for fine), scroll, take the arrow keys, and a printed stop can be clicked.

import { valueFromDrag } from "@dh/ui-kit";
import { useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";

const A0 = -135;
const A1 = 135;
const angleOf = (i: number, n: number) => (n === 1 ? 0 : A0 + ((A1 - A0) * i) / (n - 1));

const CAPS = { orange: ["#f3a24b", "#c06a12"], white: ["#f6f4ee", "#b9b5a8"], black: ["#2a2a28", "#0b0b0a"] } as const;

export interface KnobProps {
  label: string;
  /** What each stop is called round the dial; omit to print no stops. */
  stops: readonly string[];
  value: number;
  onChange: (index: number) => void;
  /** The value window under the knob; omit for none. */
  readout?: string;
  radius?: number;
  cap?: keyof typeof CAPS;
  labelled?: boolean;
  disabled?: boolean;
  /** The Parkbench flag it sets, for the tooltip. */
  flag?: string;
  x: number;
  y: number;
}

export function Knob({ label, stops, value, onChange, readout, radius = 20, cap = "black", labelled, disabled, flag, x, y }: KnobProps) {
  const drag = useRef<{ y: number; value: number } | null>(null);
  const last = stops.length - 1;
  const set = (next: number) => {
    const clamped = Math.max(0, Math.min(last, next));
    if (!disabled && clamped !== value) onChange(clamped);
  };
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || disabled) return;
    const stop = (e.target as Element).closest("[data-stop]");
    if (stop) {
      set(Number(stop.getAttribute("data-stop")));
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, value };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current) set(valueFromDrag(drag.current.value, drag.current.y - e.clientY, 0, last, 1, e.shiftKey));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    if (e.deltaY !== 0) set(value + (e.deltaY < 0 ? 1 : -1));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowUp: value + 1, ArrowRight: value + 1, ArrowDown: value - 1, ArrowLeft: value - 1, Home: 0, End: last };
    if (e.key in moves) {
      e.preventDefault();
      set(moves[e.key]);
    }
  };

  const pad = labelled ? 34 : 12;
  const size = (radius + pad) * 2;
  const c = size / 2;
  const [face, ring] = CAPS[cap];
  const rad = (i: number) => ((angleOf(i, stops.length) - 90) * Math.PI) / 180;
  return (
    <div className={`pb1-knob${disabled ? " off" : ""}`} style={{ left: x, top: y }}
      role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-disabled={disabled || undefined}
      aria-valuemin={0} aria-valuemax={last} aria-valuenow={value} aria-valuetext={readout ?? stops[value]}
      title={disabled ? `${label}: doesn't apply here` : `${label}: ${readout ?? stops[value]}${flag ? ` (${flag})` : ""}`}
      onKeyDown={onKeyDown}>
      <div className="pb1-lab">{label}</div>
      <svg width={size} height={size} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp} onWheel={onWheel}>
        {stops.map((stop, i) => {
          const t = rad(i);
          const cos = Math.cos(t);
          return (
            <g key={i}>
              <line x1={c + cos * (radius + 5)} y1={c + Math.sin(t) * (radius + 5)} x2={c + cos * (radius + 10)} y2={c + Math.sin(t) * (radius + 10)} stroke="#bdb9ad" strokeWidth="1.5" />
              {labelled && (
                <text data-stop={i} className={`pb1-stop${i === value ? " on" : ""}`} x={c + cos * (radius + 20)} y={c + Math.sin(t) * (radius + 20) + 3}
                  textAnchor={Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end"}>{stop}</text>
              )}
            </g>
          );
        })}
        <circle cx={c} cy={c} r={radius + 2} fill="#0b0b0a" />
        <g style={{ transform: `rotate(${angleOf(value, stops.length)}deg)`, transformOrigin: `${c}px ${c}px` }} className="pb1-turn">
          <circle cx={c} cy={c} r={radius} fill={ring} />
          <circle cx={c} cy={c} r={radius * 0.72} fill={face} />
          <line x1={c} y1={c - radius * 0.2} x2={c} y2={c - radius + 2} stroke={cap === "white" ? "#222" : "#ff4d1f"} strokeWidth="3" strokeLinecap="round" />
        </g>
      </svg>
      {readout !== undefined && <div className="pb1-val">{readout}</div>}
    </div>
  );
}

export interface SlideProps {
  label?: string;
  options: readonly string[];
  value: number;
  onChange: (index: number) => void;
  horizontal?: boolean;
  disabled?: boolean;
  flag?: string;
  x: number;
  y: number;
}

/** Click an option to pick it, or the switch to move it on one. */
export function Slide({ label, options, value, onChange, horizontal, disabled, flag, x, y }: SlideProps) {
  const n = options.length;
  const at = n === 1 ? 0 : value / (n - 1);
  const thumb = horizontal ? { left: 3 + (56 - 24) * at } : { top: 3 + (40 - 22) * at };
  return (
    <div className={`pb1-slide${horizontal ? " h" : ""}${disabled ? " off" : ""}`} style={{ left: x, top: y }}
      role="radiogroup" aria-label={label || options.join(" or ")} title={flag && !disabled ? flag : undefined}>
      {label && <div className="pb1-lab">{label}</div>}
      <button className="pb1-slot" disabled={disabled} aria-label={`${label || "switch"}: ${options[value]}`}
        onClick={() => onChange((value + 1) % n)}>
        <span className="pb1-thumb" style={thumb} />
      </button>
      <div className="pb1-opts">
        {options.map((o, i) => (
          <button key={o} role="radio" aria-checked={i === value} className={i === value ? "on" : ""} disabled={disabled} onClick={() => onChange(i)}>{o}</button>
        ))}
      </div>
    </div>
  );
}

/** A cream name plate under a channel. */
export function Plate({ x, y, big, small, mid }: { x: number; y?: number; big: string; small?: string; mid?: boolean }) {
  return (
    <div className={`pb1-plate${mid ? " mid" : " bottom"}`} style={{ left: x, top: y }}>
      {big}
      {small && <small>{small}</small>}
    </div>
  );
}
