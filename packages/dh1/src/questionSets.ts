// Your own question sets (MINE), next to the built-in ones: JSON files in
// ~/Library/Application Support/Duck Harness/Question Sets/, kept by the Rust side
// (question_sets.rs). "Open a set file…" copies a file in, so it's remembered; opening
// a newer revision of the same set replaces it. Runs keep the revision they used.

import { invoke } from "@tauri-apps/api/core";
import { parseQuestionSet, questionSetToFile, type QuestionSet } from "@dh/formats";

/** Your sets, by name. Files that don't read as a question set are skipped (and logged). */
export async function loadUserSets(): Promise<QuestionSet[]> {
  const files = await invoke<string[]>("question_set_list");
  const sets: QuestionSet[] = [];
  for (const text of files) {
    try {
      sets.push(parseQuestionSet(text));
    } catch (e) {
      console.warn("Skipping a question set file:", e);
    }
  }
  return sets.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export interface Imported {
  set: QuestionSet;
  /** The revision it replaced, when a set with this id was already in MINE. */
  replaced?: number;
}

/** Read a set file and keep it in MINE. Refuses an id a built-in set uses. */
export async function importSet(path: string, mine: QuestionSet[], builtIn: QuestionSet[]): Promise<Imported> {
  const set = parseQuestionSet(await invoke<string>("file_read", { path }));
  if (builtIn.some((s) => s.id === set.id)) {
    throw new Error(`"${set.id}" is a built-in set's id. Give this set its own id.`);
  }
  await invoke("question_set_write", { id: set.id, contents: questionSetToFile(set) });
  const before = mine.find((s) => s.id === set.id);
  return { set, ...(before ? { replaced: before.revision } : {}) };
}

export async function removeUserSet(id: string): Promise<void> {
  await invoke("question_set_delete", { id });
}

export async function revealUserSet(id: string): Promise<void> {
  await invoke("question_set_reveal", { id });
}
