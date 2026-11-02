// The handle between the Activity and Answer panes: drag to trade width between them,
// arrow keys to nudge, double-click to reset.

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { answerWidthAt } from "../layout";

interface Props {
  /** The element holding both panes, for measuring. */
  container: React.RefObject<HTMLElement | null>;
  answerWidth: number;
  onChange: (width: number) => void;
  onReset: () => void;
}

const GUTTER = 12;

export function Splitter({ container, answerWidth, onChange, onReset }: Props) {
  const dragging = useRef(false);

  const widthAt = (x: number) => {
    const box = container.current?.getBoundingClientRect();
    return box ? answerWidthAt(x, box.left, box.right, GUTTER) : answerWidth;
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
    const step = e.shiftKey ? 80 : 20;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const box = container.current?.getBoundingClientRect();
    if (!box) return;
    // Moving the handle left widens the answer.
    const handleX = box.right - answerWidth - GUTTER / 2;
    onChange(widthAt(handleX + (e.key === "ArrowLeft" ? -step : step)));
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the Activity and Answer panes"
      aria-valuenow={answerWidth}
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
