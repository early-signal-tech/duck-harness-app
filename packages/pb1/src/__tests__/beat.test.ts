import { describe, expect, it } from "vitest";
import { BEAT_TEMPO, GROOVE, hitsFor, nextPace, stallAfter, stepSeconds } from "../beat";
import { active, DEFAULT_SETTINGS, runFlags, TEMPO_STREAM } from "../settings";

describe("beat tempo", () => {
  it("lands each tick on the 16-step grid where it says it does", () => {
    for (const interval of TEMPO_STREAM) {
      const steps = interval / stepSeconds(BEAT_TEMPO[interval].bpm);
      expect(Number.isInteger(steps)).toBe(BEAT_TEMPO[interval].every !== null);
    }
    expect(BEAT_TEMPO[2]).toEqual({ bpm: 120, every: "1 bar" });
  });

  it("speeds up to 140 and 160 BPM at the two fastest stops", () => {
    expect(BEAT_TEMPO[0.25].bpm).toBe(140);
    expect(BEAT_TEMPO[0.1].bpm).toBe(160);
    for (const interval of TEMPO_STREAM) expect(BEAT_TEMPO[interval].bpm).toBeGreaterThanOrEqual(96);
  });
});

describe("what plays", () => {
  it("plays the groove when ticks are coming", () => {
    expect(hitsFor(0, "playing")).toEqual([["BD", 1], ["CH", 1]]);
    expect(hitsFor(4, "playing")).toEqual([["SD", 1], ["CH", 0.9]]);
    const all = Array.from({ length: 16 }, (_, i) => hitsFor(i, "playing")).flat();
    expect(all.filter(([v]) => v === "BD")).toHaveLength(GROOVE.BD.length);
  });

  it("drops to a quiet hat on a stall", () => {
    const all = Array.from({ length: 16 }, (_, i) => hitsFor(i, "stalled")).flat();
    expect(all).toHaveLength(8);
    expect(all.every(([v, vel]) => v === "CH" && vel < 0.5)).toBe(true);
  });

  it("keeps the kick and hat while flushing, and nothing before the first tick", () => {
    const flush = Array.from({ length: 16 }, (_, i) => hitsFor(i, "flushing")).flat();
    expect(new Set(flush.map(([v]) => v))).toEqual(new Set(["BD", "CH"]));
    expect(Array.from({ length: 16 }, (_, i) => hitsFor(i, "waiting")).flat()).toEqual([]);
  });
});

describe("stalls", () => {
  it("follows how fast ticks really come, so a slow catalog isn't a stall", () => {
    // ducklake_prod: about 3.5s a tick at a 2s TEMPO.
    let pace = 2;
    for (let i = 0; i < 10; i++) pace = nextPace(pace, 3.5);
    expect(pace).toBeCloseTo(3.5, 1);
    expect(stallAfter(2, pace)).toBeGreaterThan(3.5 * 2);
  });

  it("never calls a tick late sooner than twice TEMPO", () => {
    expect(stallAfter(2, 0.5)).toBe(4.25);
    expect(stallAfter(0.1, 0.1)).toBeCloseTo(0.45);
  });
});

describe("BEAT setting", () => {
  it("is off by default, applies only to STREAM, and sends no flag", () => {
    expect(DEFAULT_SETTINGS.beat).toBe(false);
    expect(active({ ...DEFAULT_SETTINGS, mode: "STREAM" }).beat).toBe(true);
    expect(active({ ...DEFAULT_SETTINGS, mode: "BATCH" }).beat).toBe(false);
    const flags = runFlags({ ...DEFAULT_SETTINGS, mode: "STREAM", beat: true });
    expect(Object.keys(flags).some((f) => f.includes("beat"))).toBe(false);
  });
});
