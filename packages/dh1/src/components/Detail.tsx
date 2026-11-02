// SQL or thinking under an Activity line: three lines at most, click to show all of it
// (and click again to fold it back).

import { useLayoutEffect, useRef, useState } from "react";

export function Detail({ text }: { text: string }) {
  // The padded box is the outer element; the text inside it is what gets clipped, so
  // the cut always falls between lines, never through one.
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    // Text size and pane width both change where lines break.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, open]);

  return (
    <div
      className={`detail${open ? " open" : ""}${clipped || open ? " clipped" : ""}`}
      title={open ? "Click to fold" : clipped ? "Click to show all" : undefined}
      onClick={() => {
        // Don't fold away a selection someone is making.
        if (window.getSelection()?.toString()) return;
        if (clipped || open) setOpen(!open);
      }}
    >
      <code ref={ref} className="detail-text">
        {/* SQL often starts or ends with a newline; don't spend a visible line on it. */}
        {text.trim()}
      </code>
    </div>
  );
}
