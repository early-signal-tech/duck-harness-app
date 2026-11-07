// The next setlist, before it runs: the question set, the preset columns, repeats, and
// concurrency (remembered between launches), your question sets (MINE), and the name and
// note being typed. It lives in DH-1's model rather than the Setlist screen, so anything
// can start it: the screen's RUN SETLIST, or the rack's transport.

import { useCallback, useEffect, useState } from "react";
import { FACTORY_QUESTION_SETS, type QuestionSet } from "@dh/formats";
import type { Preset } from "./presets";
import { loadUserSets } from "./questionSets";
import {
  cleanName, jobCount, loadSavedPlan, MAX_NAME, MAX_NOTE, savePlan, suggestedSetlistName, type SavedPlan, type SetlistPlan,
} from "./setlist";

export interface SetlistDraft {
  saved: SavedPlan;
  edit: (patch: Partial<SavedPlan>) => void;
  /** Your sets (MINE); the built-in ones ship with the app. */
  mine: QuestionSet[];
  refreshMine: () => void;
  /** The set and the preset columns the draft names (presets that are gone are left out). */
  set: QuestionSet;
  columns: Preset[];
  /** How many runs it makes. */
  runs: number;
  suggestedName: string;
  nameText: string;
  setNameText: (text: string) => void;
  /** You typed a name (else the suggestion is shown, and no name is stored). */
  nameEdited: boolean;
  setNameEdited: (edited: boolean) => void;
  noteText: string;
  setNoteText: (text: string) => void;
  /** The plan to start, with the name only when you changed it; and clear the name and note. */
  takePlan: () => SetlistPlan;
}

export function useSetlistDraft(presets: Preset[]): SetlistDraft {
  const [saved, setSaved] = useState<SavedPlan>(loadSavedPlan);
  useEffect(() => savePlan(saved), [saved]);
  const [mine, setMine] = useState<QuestionSet[]>([]);
  const refreshMine = useCallback(() => {
    loadUserSets().then(setMine).catch(() => setMine([]));
  }, []);
  useEffect(refreshMine, [refreshMine]);
  // The NAME box holds the suggested name as text, following the set, columns, and
  // repeats until you edit it (typing adds to it rather than replacing it); ↺ goes back to
  // the suggestion. Only an edited name is stored.
  const [nameText, setNameText] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [noteText, setNoteText] = useState("");

  const sets = [...FACTORY_QUESTION_SETS, ...mine];
  const set = sets.find((s) => s.id === saved.setId) ?? FACTORY_QUESTION_SETS[0];
  const columns = saved.columnIds.map((id) => presets.find((p) => p.id === id)).filter((p): p is Preset => p !== undefined);
  const suggestedName = suggestedSetlistName({ set, columns, repeats: saved.repeats });

  const takePlan = (): SetlistPlan => {
    // Untouched (or edited back to the suggestion): no name, so nothing generated is stored.
    const typed = nameEdited ? cleanName(nameText, MAX_NAME) : "";
    const name = typed && typed !== suggestedName ? typed : "";
    const note = cleanName(noteText, MAX_NOTE);
    setNameEdited(false);
    setNameText("");
    setNoteText("");
    return {
      ...(name ? { name } : {}),
      ...(note ? { note } : {}),
      set, columns, repeats: saved.repeats, concurrency: saved.concurrency,
    };
  };

  return {
    saved,
    edit: (patch) => setSaved((p) => ({ ...p, ...patch })),
    mine, refreshMine, set, columns,
    runs: jobCount({ set, columns, repeats: saved.repeats }),
    suggestedName, nameText, setNameText, nameEdited, setNameEdited, noteText, setNoteText,
    takePlan,
  };
}
