// STREAM's beat: what it plays and when, with no audio in it, so it can be tested. The sound
// is synthesized in beatPlayer.ts; nothing is sampled.
//
// The clock comes from TEMPO. The slower stops are folded to a hip hop tempo by doubling or
// halving, so a tick on time lands on the 16-step grid; the two fastest are picked by ear
// (140 and 160 BPM) and their ticks fall between steps. The ticks themselves only add
// sounds: a duplicate claps, a drift rings the cowbell, and ticks that stop coming drop
// the beat to a quiet hat until they're back.

import type { TEMPO_STREAM } from "./settings";

export type TickInterval = (typeof TEMPO_STREAM)[number];

/** The beat for each TEMPO stop, and how far apart its ticks land: null where they don't
 *  line up with the steps. */
export const BEAT_TEMPO: Record<TickInterval, { bpm: number; every: string | null }> = {
  5: { bpm: 96, every: "2 bars" },
  2: { bpm: 120, every: "1 bar" },
  1: { bpm: 120, every: "half a bar" },
  0.5: { bpm: 120, every: "1 beat" },
  0.25: { bpm: 140, every: null },
  0.1: { bpm: 160, every: null },
};

/** One step of the 16: a 16th note. */
export const stepSeconds = (bpm: number) => 60 / bpm / 4;

/** Odd steps are pushed late by up to a third of a step; this is the sketch's 45%. */
export const SWING = 0.45 * 0.33;

export type Voice = "BD" | "SD" | "CH" | "OH" | "CP" | "CB" | "CY";
export type Hit = readonly [Voice, number];

/** Boom bap, as [step, velocity]. */
export const GROOVE: Record<"BD" | "SD" | "CH" | "OH", readonly (readonly [number, number])[]> = {
  BD: [[0, 1], [7, 0.8], [10, 1]],
  SD: [[4, 1], [12, 1], [15, 0.25]],
  CH: [[0, 1], [2, 0.6], [4, 0.9], [6, 0.6], [8, 1], [10, 0.6], [12, 0.9]],
  OH: [[14, 0.7]],
};

export type BeatPhase = "waiting" | "playing" | "stalled" | "flushing" | "done";

/** What plays on a step (0–15). A stall keeps only a quiet hat; a flush keeps the kick and hat. */
export function hitsFor(step: number, phase: BeatPhase): Hit[] {
  if (phase === "playing") {
    const hits: Hit[] = [];
    for (const voice of ["BD", "SD", "CH", "OH"] as const) {
      const hit = GROOVE[voice].find(([at]) => at === step);
      if (hit) hits.push([voice, hit[1]]);
    }
    return hits;
  }
  if (phase === "stalled") return step % 2 === 0 ? [["CH", 0.3]] : [];
  if (phase === "flushing") {
    const hits: Hit[] = [];
    if (step === 0 || step === 8) hits.push(["BD", 0.8]);
    if (step % 2 === 0) hits.push(["CH", step % 4 === 0 ? 0.7 : 0.4]);
    return hits;
  }
  return [];
}

/** The gap between ticks the beat expects: a running average of the real gaps. Remote
 *  catalogs tick slower than TEMPO asks, so TEMPO alone would call every tick late. */
export const nextPace = (pace: number, gap: number) => pace * 0.7 + gap * 0.3;

/** How long after the last tick the beat calls it a stall: twice the expected gap, and never
 *  less than twice TEMPO. */
export const stallAfter = (tickInterval: number, pace: number) => 2 * Math.max(tickInterval, pace) + 0.25;
