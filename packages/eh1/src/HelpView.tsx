// HANDBOOK: docs/EH1_HANDBOOK.md inside the app, bundled at build time so it matches the
// repo and works offline. It takes over the face until "Back to plugin" (or Esc). The
// contents links jump to their sections; QUESTION_SETS.md and DH-1's handbook are
// bundled too, and other links name the repo file.

import { Markdown } from "@dh/ui-kit";
import { useEffect, useRef, useState } from "react";
import eh1Handbook from "../../../docs/EH1_HANDBOOK.md?raw";
import dh1Handbook from "../../../docs/HANDBOOK.md?raw";
import questionSets from "../../../docs/QUESTION_SETS.md?raw";

const DOCS = {
  handbook: { title: "HANDBOOK", text: eh1Handbook },
  "question-sets": { title: "QUESTION SETS", text: questionSets },
  dh1: { title: "DH-1 HANDBOOK", text: dh1Handbook },
} as const;

export type Doc = keyof typeof DOCS;

/** Which bundled doc a link opens, if any. */
export function docForLink(href: string): Doc | null {
  const file = href.split("#")[0].split("/").pop() ?? "";
  if (file === "EH1_HANDBOOK.md") return "handbook";
  if (file === "QUESTION_SETS.md") return "question-sets";
  if (file === "HANDBOOK.md") return "dh1";
  return null;
}

const SIZE_KEY = "eh1.helpTextSize";
const readSize = () => {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return n >= 11 && n <= 22 ? n : 14;
  } catch {
    return 14;
  }
};

export function HelpView({ onBack }: { onBack: () => void }) {
  const [doc, setDoc] = useState<Doc>("handbook");
  const [note, setNote] = useState<string | null>(null);
  const [size, setSize] = useState(readSize);
  const well = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem(SIZE_KEY, String(size));
    } catch {
      // ignore
    }
  }, [size]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const open = (next: Doc) => {
    setDoc(next);
    setNote(null);
    well.current?.scrollTo({ top: 0 });
  };

  return (
    <section className="panel eh1-help" style={{ fontSize: `${size}px` }}>
      <h2>
        <span className="help-title">
          {doc !== "handbook" && <button className="pane-button" onClick={() => open("handbook")}>← Handbook</button>}
          {DOCS[doc].title}
        </span>
        <span className="h2-tools">
          <button className="pane-button" onClick={() => well.current?.scrollTo({ top: 0, behavior: "smooth" })}>↑ Contents</button>
          <button className="pane-button" aria-label="Smaller text" disabled={size <= 11} onClick={() => setSize(size - 1)}>A−</button>
          <span className="pane-size" aria-live="polite">{size}</span>
          <button className="pane-button" aria-label="Larger text" disabled={size >= 22} onClick={() => setSize(size + 1)}>A+</button>
          <button className="pane-button" onClick={onBack} title="Back to the plugin (Esc)">Back to plugin</button>
        </span>
      </h2>
      {note && <p className="help-note">{note}</p>}
      <div className="help-well" ref={well}>
        <div className="help-doc">
          <Markdown
            text={DOCS[doc].text}
            anchors
            onLocalLink={(href) => {
              const target = docForLink(href);
              if (target) open(target);
              else setNote(`${href.replace(/^\.\.\//, "")} is in the repo, not bundled with the app.`);
            }}
          />
        </div>
      </div>
    </section>
  );
}
