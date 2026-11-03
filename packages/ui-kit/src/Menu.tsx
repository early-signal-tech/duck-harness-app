// A drop-down panel under a button, like the wireframe's flyouts. Closes on Esc, on a
// click outside, or when an item calls close().

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The button (or group) the menu hangs from; clicks on it don't count as "outside". */
  anchor: ReactNode;
  children: ReactNode;
  label: string;
  align?: "left" | "right";
}

/** Close a panel on Esc or a click outside `root` (for menus and other drop-downs). */
export function useDismiss(root: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onClose();
    };
    // Capture phase, and stop it there, so Esc closes the menu without also stopping a
    // run or collapsing a pane.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [root, open, onClose]);
}

export function Menu({ open, onClose, anchor, children, label, align = "left" }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, onClose);

  return (
    <div className="menu-root" ref={root}>
      {anchor}
      {open && (
        <div className={`menu ${align}`} role="menu" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="menu-section" role="group" aria-label={title}>
      <span className="menu-title">{title}</span>
      {children}
    </div>
  );
}

export function MenuItem({ children, onSelect, checked, disabled, hint, danger }: {
  children: ReactNode;
  onSelect: () => void;
  checked?: boolean;
  disabled?: boolean;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <button
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className={`menu-item${danger ? " danger" : ""}`}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="menu-check" aria-hidden="true">{checked ? "✓" : ""}</span>
      <span className="menu-label">{children}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );
}

export function MenuDivider() {
  return <hr className="menu-divider" />;
}
