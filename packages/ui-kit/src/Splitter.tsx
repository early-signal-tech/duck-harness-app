// A vertical handle between two side-by-side panes: drag to trade width between them,
// arrow keys to nudge (Shift for bigger steps), double-click to reset. It sets the
// width of the pane to its right; the left pane takes what's left.

import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

export const SPLITTER_GUTTER = 12;

/** Right-pane width for a handle at `pointerX`, keeping both panes above their minimums.
 *  `left` and `right` are the edges of the area the two panes share. */
export function splitWidthAt(
  pointerX: number, left: number, right: number, gutter: number, minRight: number, minLeft: number,
): number {
  const max = right - left - gutter - minLeft;
  const width = right - pointerX - gutter / 2;
  return Math.round(Math.max(minRight, Math.min(max, width)));
}

interface Props {
  /** The element holding both panes, for measuring. */
  container: RefObject<HTMLElement | null>;
  /** Current width of the right pane. */
  width: number;
  minRight: number;
  minLeft: number;
  onChange: (width: number) => void;
  onReset: () => void;
  label: string;
}

export function Splitter({ container, width, minRight, minLeft, onChange, onReset, label }: Props) {
  const dragging = useRef(false);

  const widthAt = (x: number) => {
    const box = container.current?.getBoundingClientRect();
    return box ? splitWidthAt(x, box.left, box.right, SPLITTER_GUTTER, minRight, minLeft) : width;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onChange(widthAt(e.clientX));
  };
  const onPointerUp = () => {
    dragging.current = false;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const box = container.current?.getBoundingClientRect();
    if (!box) return;
    const step = e.shiftKey ? 80 : 20;
    // Moving the handle left widens the right pane.
    const handleX = box.right - width - SPLITTER_GUTTER / 2;
    onChange(widthAt(handleX + (e.key === "ArrowLeft" ? -step : step)));
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span className="grip" aria-hidden="true" />
    </div>
  );
}
