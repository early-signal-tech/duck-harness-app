// INPUT's PICK drop-down: every setlist in the traces, grouped by question set, with a
// search, an ALL / NOT GRADED / GRADED filter, and for each one how far it ran, how much
// is graded with the face's settings, its presets and what differed between them.

import { useDismiss } from "@dh/ui-kit";
import { useEffect, useRef, useState } from "react";
import type { QuestionSet } from "@dh/formats";
import type { SetlistInfo } from "./engine";
import {
  differs, gradeStatus, groupSetlists, matchesSearch, passesFilter, presetNames, runStatus, setlistTitle, shapeOf, whenOf,
  type GradeFilter,
} from "./picker";

const FILTERS: [GradeFilter, string][] = [["all", "ALL"], ["not-graded", "NOT GRADED"], ["graded", "GRADED"]];
const money = (n: number | null) => (n === null ? "" : ` · $${n.toFixed(n >= 1 ? 2 : 3)}`);

export function SetlistPicker({ setlists, selected, setOf, onPick, onRename, onOpen }: {
  setlists: SetlistInfo[];
  selected: SetlistInfo | null;
  setOf: (s: SetlistInfo) => QuestionSet | null;
  onPick: (id: string) => void;
  /** Rename the selected setlist (the INPUT panel shows the form). */
  onRename: () => void;
  /** Called on opening, to fetch the newest list. */
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GradeFilter>("all");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useDismiss(root, open, () => setOpen(false));
  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  const setName = (s: SetlistInfo) => setOf(s)?.name;
  const groups = groupSetlists(
    setlists,
    (s) => passesFilter(s, filter) && matchesSearch(s, query, setName(s)),
    (id) => {
      const newest = setlists.find((s) => s.question_set === id);
      return newest ? setOf(newest) : null;
    },
  );

  return (
    <div className="menu-root eh1-picker-root" ref={root}>
      <button className="field-button" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => {
          if (!open) onOpen();
          setOpen(!open);
        }}>
        <span>{selected ? setlistTitle(selected, setName(selected)) : "Pick a setlist"}</span><span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="menu left eh1-picker" role="dialog" aria-label="Setlists">
          <div className="picker-top">
            <label className="visually-hidden" htmlFor="eh1-setlist-search">Search setlists</label>
            <input id="eh1-setlist-search" ref={search} type="search" value={query} placeholder="Search by name, note, set, preset, or date…"
              onChange={(e) => setQuery(e.currentTarget.value)} />
            <div className="segmented" role="radiogroup" aria-label="Show">
              {FILTERS.map(([f, label]) => (
                <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{label}</button>
              ))}
            </div>
          </div>
          {groups.length === 0 && <p className="picker-empty">{setlists.length ? "No setlists match." : "No setlists in the traces yet. Run one in DH-1's Setlist."}</p>}
          {groups.map((group) => (
            <div key={group.questionSet} className="picker-group" role="group" aria-label={group.set?.name ?? group.questionSet}>
              <div className="picker-group-head">
                <span>
                  {(group.set?.name ?? group.questionSet).toUpperCase()}
                  {group.set && ` · REV ${group.set.revision} · ${group.set.questions.length} QUESTIONS`}
                </span>
                <span>{group.setlists.length} setlist{group.setlists.length === 1 ? "" : "s"}</span>
              </div>
              {group.setlists.map((s) => {
                const set = setOf(s);
                const isSelected = s.id === selected?.id;
                const run = runStatus(s, set);
                const grade = gradeStatus(s);
                const diff = differs(s.presets ?? []);
                const oldRevision = set && s.revision != null && s.revision !== set.revision;
                return (
                  <div key={s.id} className={`picker-item${isSelected ? " selected" : ""}`}>
                    <button className="picker-pick" aria-current={isSelected} onClick={() => { onPick(s.id); setOpen(false); }}>
                      <span className="check" aria-hidden="true">{isSelected ? "✓" : ""}</span>
                      <span className="body">
                        <span className="name">
                          {setlistTitle(s, set?.name)}
                          {group.latest === s.id && <span className="tag">LATEST</span>}
                        </span>
                        {s.note && <span className="note">{s.note}</span>}
                        <span className="meta">{whenOf(s)} · {shapeOf(s)} · {s.runs} runs{money(s.cost_usd)}{oldRevision && ` · ran rev ${s.revision}`}</span>
                        {s.presets && s.presets.length > 0 && <span className="meta" title={presetNames(s.presets)}>{presetNames(s.presets)}</span>}
                        {s.presets && s.presets.length > 1 && <span className="meta" title={diff.full}><b>differs: {diff.short}</b></span>}
                      </span>
                      <span className="badges">
                        <span className={`badge run-${run.kind}`}>{run.label}</span>
                        {grade && <span className={`badge grade-${grade.kind}`} title={grade.title}>{grade.label}</span>}
                      </span>
                    </button>
                    {isSelected && (
                      <button className="pane-button picker-rename" onClick={() => { setOpen(false); onRename(); }}>Rename…</button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <p className="picker-foot">From the traces: every run labelled with the same setlist ID.</p>
        </div>
      )}
    </div>
  );
}

/** Your name and note for a setlist. The name box starts with its title (typing adds to
 *  it); leaving the suggested title as it is stores no name. */
export function RenameForm({ setlist, suggested, onSave, onCancel }: {
  setlist: SetlistInfo;
  suggested: string;
  onSave: (name: string, note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(setlist.name || suggested);
  const [note, setNote] = useState(setlist.note ?? "");
  const [saving, setSaving] = useState(false);
  return (
    <form className="eh1-rename" onSubmit={(e) => {
      e.preventDefault();
      setSaving(true);
      void onSave(name, note).finally(() => setSaving(false));
    }}>
      <label className="caps muted" htmlFor="eh1-rename-name">NAME</label>
      <div className="name-row">
        <input id="eh1-rename-name" value={name} maxLength={80} autoFocus
          onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
          onChange={(e) => setName(e.currentTarget.value)} />
        {name !== suggested && (
          <button type="button" className="pane-button" title="Back to the suggested title" aria-label="Back to the suggested title" onClick={() => setName(suggested)}>↺</button>
        )}
      </div>
      <label className="caps muted" htmlFor="eh1-rename-note">NOTE</label>
      <input id="eh1-rename-note" value={note} maxLength={200} placeholder="What this setlist tried" onChange={(e) => setNote(e.currentTarget.value)} />
      <div className="buttons">
        <button type="button" className="pane-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="pane-button primary" disabled={saving}>Save</button>
      </div>
    </form>
  );
}
