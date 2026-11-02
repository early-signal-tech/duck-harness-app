// HANDBOOK: docs/HANDBOOK.md inside the app, bundled at build time so it always matches
// the repo and works offline. Like Compare and Setlist, it takes over the face until
// "Back to plugin" (or Esc). The contents links jump to their sections. Of the other
// docs it links to, QUESTION_SETS.md is bundled too; the rest live only in the repo.

import { useRef, useState } from "react";
import { Markdown } from "@dh/ui-kit";
import handbook from "../../../../docs/HANDBOOK.md?raw";
import questionSets from "../../../../docs/QUESTION_SETS.md?raw";

const DOCS = {
  handbook: { title: "HANDBOOK", text: handbook },
  "question-sets": { title: "QUESTION SETS", text: questionSets },
} as const;

type Doc = keyof typeof DOCS;

/** Which bundled doc a link in a doc opens, if any. */
export function docForLink(href: string): Doc | null {
  const file = href.split("#")[0].split("/").pop() ?? "";
  if (file === "HANDBOOK.md") return "handbook";
  if (file === "QUESTION_SETS.md") return "question-sets";
  return null;
}

interface Props {
  onBack: () => void;
  textSize: number;
  onTextSize: (direction: 1 | -1) => void;
}

export function HelpView({ onBack, textSize, onTextSize }: Props) {
  const [doc, setDoc] = useState<Doc>("handbook");
  const [note, setNote] = useState<string | null>(null);
  const well = useRef<HTMLDivElement>(null);

  const open = (next: Doc) => {
    setDoc(next);
    setNote(null);
    well.current?.scrollTo({ top: 0 });
  };

  return (
    <section className="panel help" style={{ "--pane-text": `${textSize}px` } as React.CSSProperties}>
      <h2>
        <span className="help-title">
          {doc !== "handbook" && (
            <button className="pane-button" onClick={() => open("handbook")} title="Back to the handbook">← Handbook</button>
          )}
          {DOCS[doc].title}
        </span>
        <div className="pane-tools">
          <button className="pane-button" onClick={() => well.current?.scrollTo({ top: 0, behavior: "smooth" })} title="Back to the contents">
            ↑ Contents
          </button>
          <button className="pane-button" onClick={() => onTextSize(-1)} title="Smaller text (⌘−)" aria-label="Smaller text">A−</button>
          <span className="pane-size" aria-live="polite">{textSize}</span>
          <button className="pane-button" onClick={() => onTextSize(1)} title="Larger text (⌘+)" aria-label="Larger text">A+</button>
          <button className="pane-button" onClick={onBack} title="Back to the plugin (Esc)">Back to plugin</button>
        </div>
      </h2>
      {note && <p className="help-note">{note}</p>}
      <div className="answer-well help-well" ref={well}>
        <div className="help-doc">
          <Markdown
            text={DOCS[doc].text}
            anchors
            onLocalLink={(href) => {
              const target = docForLink(href);
              if (target) open(target);
              else setNote(`${href.replace(/^\.\.\//, "")} is in the duck-harness-app repo, not bundled with the app.`);
            }}
          />
        </div>
      </div>
    </section>
  );
}
