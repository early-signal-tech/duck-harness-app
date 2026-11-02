// A rotary knob: drag up/down, scroll, or use the arrow keys. Double-click resets it.
// Hold Shift while dragging for fine control.

import { useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";

const SWEEP = 270; // degrees from min to max
const START = -135; // angle at min, 0 = straight up
const DRAG_PIXELS = 160; // drag distance for the full range
const FINE = 4; // Shift slows dragging by this much

export interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  format: (value: number) => string;
  hint?: string;
  onChange: (value: number) => void;
  /** "large" for the agent knobs, "medium" for the compressor, "small" for secondary
   *  ones (wireframe: 76px / 60px / 44px). */
  size?: "large" | "medium" | "small";
  disabled?: boolean;
}

export function clampToStep(value: number, min: number, max: number, step: number): number {
  const stepped = min + Math.round((value - min) / step) * step;
  return Math.min(max, Math.max(min, stepped));
}

/** The value after dragging `dy` pixels up (negative dy = down) from `start`. */
export function valueFromDrag(
  start: number, dy: number, min: number, max: number, step: number, fine = false,
): number {
  const range = max - min;
  return clampToStep(start + (dy / (DRAG_PIXELS * (fine ? FINE : 1))) * range, min, max, step);
}

export function Knob({ label, value, min, max, step = 1, defaultValue, format, hint, onChange, size = "large", disabled }: KnobProps) {
  const drag = useRef<{ y: number; value: number } | null>(null);
  const fraction = max > min ? (value - min) / (max - min) : 0;
  const angle = START + SWEEP * fraction;

  const set = (next: number) => {
    if (disabled) return;
    const clamped = clampToStep(next, min, max, step);
    if (clamped !== value) onChange(clamped);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { y: e.clientY, value };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    set(valueFromDrag(drag.current.value, drag.current.y - e.clientY, min, max, step, e.shiftKey));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.deltaY === 0) return;
    set(value + (e.deltaY < 0 ? step : -step));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const big = Math.max(step, Math.round((max - min) / 10 / step) * step);
    const moves: Record<string, number> = {
      ArrowUp: value + step,
      ArrowRight: value + step,
      ArrowDown: value - step,
      ArrowLeft: value - step,
      PageUp: value + big,
      PageDown: value - big,
      Home: min,
      End: max,
    };
    if (e.key in moves) {
      e.preventDefault();
      set(moves[e.key]);
    }
  };

  return (
    <div className={`knob ${size}${disabled ? " disabled" : ""}`}>
      <div
        className="knob-dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        title={`${label}: ${format(value)} — drag, scroll, or arrow keys; double-click to reset`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onDoubleClick={() => set(defaultValue)}
      >
        {/* Flat, as in the wireframe: white dial, gray ring, charcoal pointer bar. */}
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx={50} cy={50} r={48.5} className="knob-face" />
          <circle cx={50} cy={50} r={42.5} className="knob-ring" />
          <rect x={47.4} y={8.5} width={5.2} height={32} rx={2.6} className="knob-pointer" transform={`rotate(${angle} 50 50)`} />
        </svg>
      </div>
      <span className="knob-label">{label}</span>
      <span className="knob-readout">{format(value)}</span>
      {hint && <span className="knob-hint">{hint}</span>}
    </div>
  );
}

/** A knob that steps through a list of values (token counts, timeouts) rather than a
 *  smooth range. A value that isn't on the list shows at the nearest step. */
export function SteppedKnob({ values, value, defaultValue, onChange, ...rest }: Omit<KnobProps, "min" | "max" | "step" | "value" | "defaultValue" | "onChange" | "format"> & {
  values: readonly number[];
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
}) {
  const nearest = (v: number) =>
    values.reduce((best, candidate, i) => (Math.abs(candidate - v) < Math.abs(values[best] - v) ? i : best), 0);
  const format = rest.format;
  return (
    <Knob
      {...rest}
      min={0}
      max={values.length - 1}
      value={nearest(value)}
      defaultValue={nearest(defaultValue)}
      // Show the real value when it's off the list (e.g. from an imported preset).
      format={(i) => format(i === nearest(value) ? value : values[i])}
      onChange={(i) => onChange(values[i])}
    />
  );
}
