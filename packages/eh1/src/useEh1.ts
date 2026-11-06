// EH-1's model: what the device knows and can do, apart from how it's drawn. The face
// (Eh1Face), and in the rack the compact card and AUTO GRADER, are views of one model.
//
// It holds the judge settings, the question sets, the setlists and which one is shown
// (FOLLOW or PICK), that setlist's grades, grading and its progress, overrides, export,
// and (in a chain) following DH-1 for AUTO-GRADE. It doesn't hold what's open on the
// face (SETLIST or RUN, the Handbook, a picked cell, menus): that belongs to each view.

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FACTORY_QUESTION_SETS, parseQuestionSet, questionSetToFile, type QuestionSet } from "@dh/formats";
import { IDLE, onFollowEvent, type ChainControl, type FollowStatus } from "./chain";
import { type Engine, type FollowEvent, type Grade, type GraderSettings, type Grading, type Hello, type Override, type SetlistInfo } from "./engine";
import { csvFileName, gradesCsv, gradesSql } from "./exportGrades";
import { cleanText, MAX_NOTE, nameToStore, setlistTitle } from "./picker";
import { findSet, loadGrader, saveGrader } from "./scorecard";
import type { EngineConnection } from "./useEngine";

export type InputMode = "follow" | "pick";

export interface Eh1Model {
  engine: EngineConnection;
  client: Engine | null;
  hello: Hello | null;
  ready: boolean;
  grader: GraderSettings;
  setGrader: (grader: GraderSettings) => void;
  mode: InputMode;
  setMode: (mode: InputMode) => void;
  sets: QuestionSet[];
  reloadSets: () => Promise<void>;
  setlists: SetlistInfo[];
  refreshSetlists: () => Promise<void>;
  setPickedId: (id: string | null) => void;
  /** The setlist shown: the newest (FOLLOW) or the one picked. */
  setlist: SetlistInfo | null;
  /** The question set it's graded with, and whether that's a newer revision than it ran. */
  set: QuestionSet | null;
  revisionMismatch: boolean;
  setOf: (setlist: SetlistInfo) => QuestionSet | null;
  /** Your name and note for the setlist shown. Resolves true when saved. */
  rename: (name: string, note: string) => Promise<boolean>;
  grades: Grade[];
  graderKey: string | null;
  loadGrades: () => Promise<void>;
  grading: Grading | null;
  progress: { done: number; total: number } | null;
  regrade: boolean;
  setRegrade: (regrade: boolean) => void;
  grade: () => void;
  stopGrading: () => void;
  regradeCell: (runIds: string[]) => void;
  saveOverride: (runId: string, value: Omit<Override, "at"> | null) => Promise<void>;
  exportCsv: () => Promise<void>;
  openShell: () => Promise<void>;
  problem: string | null;
  notice: string | null;
  /** In a chain: whether AUTO-GRADE is on. */
  autoGrade: boolean;
}

async function loadSets(): Promise<QuestionSet[]> {
  const mine: QuestionSet[] = [];
  try {
    for (const text of await invoke<string[]>("question_set_list")) {
      try {
        mine.push(parseQuestionSet(text));
      } catch (e) {
        console.warn("Skipping a question set file:", e);
      }
    }
  } catch {
    // No native side (a browser preview): built-in sets only.
  }
  return [...FACTORY_QUESTION_SETS, ...mine];
}

export const money = (n: number | null) => (n === null ? "–" : n >= 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(4)}`);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface Eh1Options {
  /** Where this EH-1 keeps its settings: "eh1" for the standalone one; another prefix for
   *  another instance (the rack's AUTO GRADER keeps its own EH-1). */
  storage?: string;
  /** False while this EH-1 isn't in the rack's chain: it doesn't look for setlists. */
  active?: boolean;
}

export function useEh1(engine: EngineConnection, chain?: ChainControl, { storage = "eh1", active = true }: Eh1Options = {}): Eh1Model {
  const { engine: client, status, hello } = engine;
  const ready = status === "ready" && client !== null && active;

  const [grader, setGrader] = useState(() => loadGrader(storage));
  useEffect(() => saveGrader(grader, storage), [grader, storage]);
  const [mode, setMode] = useState<InputMode>(() => {
    try {
      return localStorage.getItem(`${storage}.input`) === "pick" ? "pick" : "follow";
    } catch {
      return "follow";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`${storage}.input`, mode);
    } catch {
      // ignore
    }
  }, [mode, storage]);

  const [sets, setSets] = useState<QuestionSet[]>(FACTORY_QUESTION_SETS);
  const reloadSets = useCallback(async () => setSets(await loadSets()), []);
  useEffect(() => {
    void reloadSets();
  }, [reloadSets]);
  const [setlists, setSetlists] = useState<SetlistInfo[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Each setlist with how much of it is graded with these settings (and the set revisions
  // this face would grade with).
  const setRefs = useMemo(() => sets.map((s) => ({ id: s.id, revision: s.revision })), [sets]);
  const refreshSetlists = useCallback(async () => {
    if (!client || !ready) return;
    try {
      setSetlists(await client.setlists(grader, setRefs));
    } catch (e) {
      setProblem(message(e));
    }
  }, [client, ready, grader, setRefs]);
  useEffect(() => {
    void refreshSetlists();
  }, [refreshSetlists]);
  // FOLLOW DH-1: look for a newer setlist every 15 s.
  useEffect(() => {
    if (mode !== "follow" || !ready) return;
    const timer = setInterval(() => void refreshSetlists(), 15_000);
    return () => clearInterval(timer);
  }, [mode, ready, refreshSetlists]);

  const setlist = mode === "follow" ? setlists[0] ?? null : setlists.find((s) => s.id === pickedId) ?? setlists[0] ?? null;
  const { set, revisionMismatch } = findSet(sets, setlist);
  const setOf = useCallback((s: SetlistInfo) => findSet(sets, s).set, [sets]);

  const rename = async (name: string, note: string) => {
    if (!client || !setlist) return false;
    setProblem(null);
    try {
      await client.rename(setlist.id, nameToStore(name, setlist, set?.name), cleanText(note, MAX_NOTE) || null);
      await refreshSetlists();
      return true;
    } catch (e) {
      setProblem(message(e));
      return false;
    }
  };

  // A new setlist arriving while following: say so.
  const autoGrade = !!chain?.autoGrade;
  const lastFollowed = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "follow" || !setlist) return;
    if (lastFollowed.current && lastFollowed.current !== setlist.id) {
      setNotice(autoGrade
        ? `New setlist from DH-1: “${setlistTitle(setlist, set?.name)}”. AUTO-GRADE is grading it as it plays.`
        : `New setlist from DH-1: “${setlistTitle(setlist, set?.name)}”. Press GRADE SETLIST to grade it.`);
    }
    lastFollowed.current = setlist.id;
  }, [mode, setlist, set, autoGrade]);

  // The grades for this setlist under these settings.
  const [grades, setGrades] = useState<Grade[]>([]);
  const [graderKey, setGraderKey] = useState<string | null>(null);
  const setFile = useMemo(() => (set ? JSON.parse(questionSetToFile(set)) : null), [set]);
  const loadGrades = useCallback(async () => {
    if (!client || !ready || !setlist || !setFile) {
      setGrades([]);
      return;
    }
    try {
      const reply = await client.grades(setlist.id, setFile, grader);
      setGrades(reply.grades);
      setGraderKey(reply.graderKey);
    } catch (e) {
      setProblem(message(e));
    }
  }, [client, ready, setlist, setFile, grader]);
  useEffect(() => {
    void loadGrades();
  }, [loadGrades]);

  // AUTO-GRADE (in a chain): the engine grades setlist runs as DH-1 finishes them, with
  // this face's judge settings and every set it has. A settings change starts a new follow,
  // which replaces the old one. Grades landing refresh the scorecard (at most once a second).
  const refreshRef = useRef({ loadGrades, refreshSetlists });
  refreshRef.current = { loadGrades, refreshSetlists };
  const onFollowRef = useRef(chain?.onFollow);
  onFollowRef.current = chain?.onFollow;
  const followStatus = useRef<FollowStatus>(IDLE);
  const report = useCallback((next: FollowStatus) => {
    followStatus.current = next;
    onFollowRef.current?.(next);
  }, []);
  const setFiles = useMemo(() => sets.map((s) => JSON.parse(questionSetToFile(s))), [sets]);
  useEffect(() => {
    if (!autoGrade || !ready || !client) {
      if (followStatus.current.active) report({ ...followStatus.current, active: false });
      return;
    }
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        void refreshRef.current.loadGrades();
        void refreshRef.current.refreshSetlists();
      }, 1000);
    };
    const following = client.follow(grader, setFiles, (event: FollowEvent) => {
      report(onFollowEvent(followStatus.current, event));
      if (event.event === "graded") refreshSoon();
    });
    following.done.catch((e) => report({ ...followStatus.current, active: false, problem: message(e) }));
    return () => {
      if (pending) clearTimeout(pending);
      void following.stop().catch(() => {});
      report({ ...followStatus.current, active: false });
    };
  }, [autoGrade, ready, client, grader, setFiles, report]);

  // Grading.
  const [grading, setGrading] = useState<Grading | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [regrade, setRegrade] = useState(false);
  const grade = () => {
    if (!client || !setlist || !setFile || grading) return;
    setProblem(null);
    setNotice(null);
    let done = 0;
    const g = client.grade(setlist.id, setFile, grader, { regrade, concurrency: 4 }, (event) => {
      if (event.event === "grade_start") setProgress({ done: 0, total: event.to_grade });
      if (event.event === "graded" || event.event === "grade_error") {
        done += 1;
        setProgress((p) => (p ? { ...p, done } : p));
        if (done % 4 === 0) void loadGrades();
      }
    });
    setGrading(g);
    g.done
      .then((summary) => {
        setNotice(
          `${summary.cancelled ? "Stopped" : "Done"}: graded ${summary.graded}` +
          (summary.skipped ? `, ${summary.skipped} already graded` : "") +
          (summary.unmatched ? `, ${summary.unmatched} not in the set` : "") +
          ` · judge ${money(summary.judge_cost_usd)}` +
          (summary.errors.length ? ` · ${summary.errors.length} errors` : ""),
        );
      })
      .catch((e) => setProblem(message(e)))
      .finally(() => {
        setGrading(null);
        setProgress(null);
        setRegrade(false);
        void loadGrades();
        void refreshSetlists();
      });
  };
  const stopGrading = () => void grading?.stop().catch(() => {});

  const saveOverride = async (runId: string, value: Omit<Override, "at"> | null) => {
    if (!client || !setFile) return;
    setProblem(null);
    try {
      await client.override(runId, { questionSet: setFile, grader }, value);
      await loadGrades();
      void refreshSetlists();
    } catch (e) {
      setProblem(message(e));
    }
  };

  const regradeCell = (runIds: string[]) => {
    if (!client || !setlist || !setFile || grading) return;
    setProblem(null);
    setNotice(null);
    const g = client.grade(setlist.id, setFile, grader, { regrade: true, runIds, concurrency: 4 });
    setGrading(g);
    setProgress({ done: 0, total: runIds.length });
    g.done
      .then((summary) => setNotice(`Regraded ${summary.graded} run${summary.graded === 1 ? "" : "s"} · judge ${money(summary.judge_cost_usd)}`))
      .catch((e) => setProblem(message(e)))
      .finally(() => {
        setGrading(null);
        setProgress(null);
        void loadGrades();
        void refreshSetlists();
      });
  };

  // Getting grades out.
  const exportCsv = async () => {
    if (!setlist || !set) return;
    setProblem(null);
    try {
      const path = await save({ defaultPath: csvFileName(setlist), filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      await invoke("file_write", { path, contents: gradesCsv(setlist, set, grades) });
      setNotice(`Saved ${grades.length} grades to ${path}`);
    } catch (e) {
      setProblem(message(e));
    }
  };
  const openShell = async () => {
    if (!setlist || !graderKey) return;
    setProblem(null);
    const sql = gradesSql(setlist.id, graderKey);
    let copied = false;
    try {
      await navigator.clipboard.writeText(sql);
      copied = true;
    } catch {
      // No clipboard: the notice says where the query is.
    }
    try {
      await invoke("traces_shell_open");
      setNotice(copied
        ? "Opened the DuckDB shell on the traces. The query for this scorecard is on your clipboard: paste it there."
        : `Opened the DuckDB shell on the traces. Query: ${sql.split("\n").slice(1).join(" ")}`);
    } catch (e) {
      setProblem(message(e));
    }
  };

  return {
    engine, client, hello, ready,
    grader, setGrader, mode, setMode,
    sets, reloadSets, setlists, refreshSetlists, setPickedId,
    setlist, set, revisionMismatch, setOf, rename,
    grades, graderKey, loadGrades,
    grading, progress, regrade, setRegrade, grade, stopGrading, regradeCell, saveOverride,
    exportCsv, openShell,
    problem, notice, autoGrade,
  };
}
