// Runs a setlist on the engine: keeps `concurrency` runs going until every job is done,
// and stops them all on STOP. It lives at the device level, so a setlist keeps running
// while you're back on the face.

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Harness, Run, RunRequest } from "./harness";
import type { FaceSettings } from "./settings";
import {
  jobRequest, newSetlistRunId, nextJobs, SETLIST_IDLE, setlistReducer, type SetlistPlan, type SetlistState,
} from "./setlist";

export interface SetlistControls {
  state: SetlistState;
  busy: boolean;
  start: (plan: SetlistPlan) => void;
  stop: () => void;
  clear: () => void;
}

type RunLabels = NonNullable<RunRequest["labels"]>;

/** `extraLabels` are added to every run's labels (the rack's preset, say). */
export function useSetlist(harness: Harness | null, face: FaceSettings, extraLabels?: RunLabels): SetlistControls {
  const [state, dispatch] = useReducer(setlistReducer, SETLIST_IDLE);
  const runs = useRef(new Map<number, Run>());
  // The face settings a run's request is built from (only the parts presets don't set
  // matter, and they don't change what's measured), read when each run starts.
  const faceRef = useRef(face);
  faceRef.current = face;
  const labelsRef = useRef(extraLabels);
  labelsRef.current = extraLabels;

  // Start queued jobs whenever there's room.
  useEffect(() => {
    if (!harness) return;
    for (const job of nextJobs(state)) {
      if (runs.current.has(job.index)) continue;
      dispatch({ type: "jobStarted", index: job.index });
      let run: Run;
      try {
        const request = jobRequest(faceRef.current, state, job);
        if (labelsRef.current) request.labels = { ...labelsRef.current, ...request.labels };
        run = harness.run(request, (event) => {
          if (event.event === "api_call_start") dispatch({ type: "iteration", index: job.index, iteration: event.iteration });
        });
      } catch (e) {
        dispatch({ type: "jobFailed", index: job.index, error: e instanceof Error ? e.message : String(e), at: Date.now() });
        continue;
      }
      runs.current.set(job.index, run);
      run.done
        .then((result) => dispatch({ type: "jobDone", index: job.index, result, at: Date.now() }))
        .catch((e) => dispatch({ type: "jobFailed", index: job.index, error: e instanceof Error ? e.message : String(e), at: Date.now() }))
        .finally(() => runs.current.delete(job.index));
    }
  }, [harness, state]);

  const busy = state.phase === "running" || state.phase === "stopping";

  const start = useCallback((plan: SetlistPlan) => {
    const now = new Date();
    dispatch({ type: "start", plan, runId: newSetlistRunId(now), at: now.getTime() });
  }, []);

  const stop = useCallback(() => {
    dispatch({ type: "stop", at: Date.now() });
    for (const run of runs.current.values()) run.stop().catch(() => {});
  }, []);

  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  return { state, busy, start, stop, clear };
}
