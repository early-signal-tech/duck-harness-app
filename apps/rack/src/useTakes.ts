// The rack's takes: the loaded preset's takes from the traces (newest first), which one
// the panel shows, and that take's runs. "The newest" follows what's playing: from PLAY
// until the take lands in the traces, the panel shows it live from DH-1.

import type { Harness, TakeRun, TakeSummary } from "@dh/dh1";
import { useCallback, useEffect, useRef, useState } from "react";
import { stepTake, type TakePick } from "./takes";

export interface Takes {
  takes: TakeSummary[];
  pick: TakePick;
  /** The take the panel shows from the traces, or null when it shows the live one. */
  shown: TakeSummary | null;
  /** Show what's playing (or just finished) from DH-1, until it's in the traces. */
  live: boolean;
  runs: TakeRun[] | null;
  step: (direction: 1 | -1) => void;
  /** PLAY was pressed: follow the new take. */
  follow: () => void;
  problem: string | null;
}

export function useTakes(harness: Harness | null, rackPreset: string | null, playing: boolean): Takes {
  const [takes, setTakes] = useState<TakeSummary[]>([]);
  const [pick, setPick] = useState<TakePick>(null);
  const [live, setLive] = useState(false);
  const [runs, setRuns] = useState<TakeRun[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!harness) return;
    try {
      setTakes(await harness.takes(rackPreset));
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }, [harness, rackPreset]);

  // Another preset: its own takes, from the newest. The old list goes first, so a failed
  // read can't leave another preset's takes on screen.
  useEffect(() => {
    setTakes([]);
    setPick(null);
    setLive(false);
    void refresh();
  }, [refresh]);

  // When a take finishes playing, it's in the traces: read them again, then show it from
  // there. Something starting to play (from the transport, or a setlist from DH-1's editor) is
  // the newest take: follow it.
  const wasPlaying = useRef(playing);
  useEffect(() => {
    if (wasPlaying.current && !playing) {
      void refresh().then(() => setLive(false));
    } else if (!wasPlaying.current && playing) {
      setPick(null);
      setLive(true);
    }
    wasPlaying.current = playing;
  }, [playing, refresh]);

  const showLive = pick === null && (live || playing);
  const shown = showLive ? null : pick === null ? takes[0] ?? null : takes[pick] ?? null;

  // The shown take's runs.
  const shownKey = shown?.key ?? null;
  useEffect(() => {
    setRuns(null);
    if (!harness || !shownKey) return;
    let stale = false;
    harness.take(shownKey)
      .then((r) => !stale && setRuns(r))
      .catch((e) => !stale && setProblem(e instanceof Error ? e.message : String(e)));
    return () => {
      stale = true;
    };
  }, [harness, shownKey]);

  return {
    takes,
    pick,
    shown,
    live: showLive,
    runs,
    step: (direction) => setPick((p) => stepTake(p, takes.length, direction, live || playing)),
    follow: () => {
      setPick(null);
      setLive(true);
    },
    problem,
  };
}
