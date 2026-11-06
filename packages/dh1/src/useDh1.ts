// DH-1's model: what the device knows and can do, apart from how it's drawn. The face
// (Dh1Face), and in the rack the transport and the compact card, are views of one model.
//
// It holds the face settings (saved between launches) and the presets; the A and B run
// slots and their live state; the setlist; and starting and stopping runs. It doesn't hold
// layout (pane widths, text size, which screen is open): that belongs to each view.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { copyToOther, settingsForSlot, switchSlot, type Slot } from "./ab";
import type { Hello, Harness, Run } from "./harness";
import { presetRef } from "./presets";
import { IDLE, runReducer, type RunAction, type RunView } from "./runState";
import { loadSettings, requestOf, saveSettings, sourceProblem, type FaceSettings } from "./settings";
import type { EngineConnection } from "./useEngine";
import { usePresets } from "./usePresets";
import { useSetlist } from "./useSetlist";

export interface Dh1Model {
  engine: EngineConnection;
  harness: Harness | null;
  hello: Hello | null;
  server: EngineConnection["status"];
  settings: FaceSettings;
  setSettings: React.Dispatch<React.SetStateAction<FaceSettings>>;
  update: (patch: Partial<FaceSettings>) => void;
  presets: ReturnType<typeof usePresets>;
  /** Add data files to the sampler (SOURCE becomes LINE IN files). */
  addFiles: (paths: string[]) => void;
  /** Each slot's run, live; `view` is the active slot's. */
  views: Record<Slot, RunView>;
  slot: Slot;
  view: RunView;
  busy: boolean;
  anyBusy: boolean;
  setlist: ReturnType<typeof useSetlist>;
  /** Why a run can't start (no prompt, no data, a setlist running), or null. */
  problem: string | null;
  canRun: boolean;
  canRunBoth: boolean;
  /** Whether the model has a price for this model (cost estimates). */
  priced: boolean;
  start: () => void;
  startBoth: () => void;
  stop: () => void;
  switchSlot: () => void;
  copyToOther: () => void;
  /** Bumped when a run starts, so views can reset what they were pointing at. */
  runStarts: number;
}

const isBusy = (v: RunView) => v.phase === "running" || v.phase === "stopping";

export function useDh1(engine: EngineConnection): Dh1Model {
  const { harness, status: server, hello } = engine;

  const [settings, setSettings] = useState<FaceSettings>(loadSettings);
  const update = useCallback((patch: Partial<FaceSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  useEffect(() => saveSettings(settings), [settings]);

  const presets = usePresets(settings, setSettings);

  const addFiles = useCallback((paths: string[]) => {
    setSettings((s) => ({ ...s, sourceKind: "files", files: [...new Set([...s.files, ...paths])] }));
  }, []);

  // A/B: each slot has its own run; the face shows the active slot's.
  const [viewA, dispatchA] = useReducer(runReducer, IDLE);
  const [viewB, dispatchB] = useReducer(runReducer, IDLE);
  const views = { A: viewA, B: viewB };
  const dispatchers: Record<Slot, (action: RunAction) => void> = { A: dispatchA, B: dispatchB };
  const runs = useRef<Record<Slot, Run | null>>({ A: null, B: null });
  const slot = settings.abSlot;
  const view = views[slot];
  const busy = isBusy(view);
  const anyBusy = isBusy(viewA) || isBusy(viewB);
  const [runStarts, setRunStarts] = useState(0);

  // A running setlist has the engine to itself: RUN and RUN A+B wait.
  const setlist = useSetlist(harness, settings);

  const problem = setlist.busy
    ? "A setlist is running"
    : !settings.prompt.trim() ? "Type a question" : sourceProblem(settings);
  const canRun = server === "ready" && !busy && !problem;
  const canRunBoth = server === "ready" && !anyBusy && !problem;

  /** Run one slot, or both at once (an A/B pair, tagged so its runs can be found together). */
  const startSlots = useCallback(
    (slots: Slot[]) => {
      const h = harness;
      if (!h) return;
      const pair = slots.length > 1 ? `ab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` : null;
      setRunStarts((n) => n + 1);
      for (const s of slots) {
        const dispatch = dispatchers[s];
        const face = settingsForSlot(settings, s);
        dispatch({ type: "start", maxIterations: face.maxIterations, at: Date.now() });
        const r = h.run(
          requestOf(face, presetRef(face, presets.all), pair ? { ab: s, pair } : undefined),
          (event) => dispatch({ type: "event", event }),
        );
        runs.current[s] = r;
        r.done
          .then((result) => dispatch({ type: "finished", result, at: Date.now() }))
          .catch((e) => dispatch({ type: "failed", error: e instanceof Error ? e.message : String(e), at: Date.now() }))
          .finally(() => {
            if (runs.current[s] === r) runs.current[s] = null;
          });
      }
    },
    // dispatchers are stable (useReducer), so they're left out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [harness, settings, presets.all],
  );

  const start = useCallback(() => {
    if (canRun) startSlots([slot]);
  }, [canRun, slot, startSlots]);

  const startBoth = useCallback(() => {
    if (canRunBoth) startSlots(["A", "B"]);
  }, [canRunBoth, startSlots]);

  /** STOP stops whatever is running, in either slot. */
  const stop = useCallback(() => {
    for (const s of ["A", "B"] as Slot[]) {
      const r = runs.current[s];
      if (!r) continue;
      dispatchers[s]({ type: "stopping" });
      r.stop().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const priced = hello ? hello.priced_models.includes(settings.model) : true;

  return {
    engine, harness, hello, server,
    settings, setSettings, update, presets, addFiles,
    views, slot, view, busy, anyBusy, setlist,
    problem, canRun, canRunBoth, priced,
    start, startBoth, stop,
    switchSlot: () => setSettings(switchSlot),
    copyToOther: () => setSettings(copyToOther),
    runStarts,
  };
}
