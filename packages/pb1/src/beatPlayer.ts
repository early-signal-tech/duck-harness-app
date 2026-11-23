// STREAM's beat, played: a drum kit synthesized with Web Audio (oscillators, filtered noise
// and envelopes; no samples) and a look-ahead clock that schedules each 16th a little early,
// so the beat stays steady when the page is busy. What plays when is in beat.ts.
//
// It starts on the run's first tick, so a slow catalog attach is silence, not a stall.
// flush() is STOP: the kick and hat keep going while the run flushes. end() plays the crash
// on the next beat and closes the audio.

import { BEAT_TEMPO, hitsFor, nextPace, stallAfter, stepSeconds, SWING, type BeatPhase, type TickInterval, type Voice } from "./beat";
import type { RunEvent } from "./events";

export interface Beat {
  /** Each event of the run, as it arrives. */
  event(event: RunEvent): void;
  flush(): void;
  end(): void;
  setLevel(level: number): void;
  /** Stop now, no crash. */
  close(): void;
}

export interface BeatOptions {
  tickInterval: TickInterval;
  /** 0 to 1. */
  level: number;
  /** Each quarter note, as it sounds: the BEAT lamp. */
  onPulse?: () => void;
  onPhase?: (phase: BeatPhase) => void;
}

const LOOK_AHEAD = 0.12;
const PUMP_MS = 25;
const gainFor = (level: number) => Math.pow(Math.max(0, Math.min(1, level)), 1.6) * 0.9;

/** Call from a click, so the browser lets it make sound. Null where there's no Web Audio. */
export function createBeat({ tickInterval, level, onPulse, onPhase }: BeatOptions): Beat | null {
  const Ctx = typeof window === "undefined" ? undefined : window.AudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  void ctx.resume();
  const kit = createKit(ctx, gainFor(level));
  const { bpm } = BEAT_TEMPO[tickInterval];
  const step16 = stepSeconds(bpm);

  let phase: BeatPhase = "waiting";
  let ending = false;
  let closed = false;
  let step = 0;
  let nextTime = 0;
  let lastTick = 0;
  let pace: number = tickInterval;
  let clap = false;
  let bell = false;
  let pump: ReturnType<typeof setInterval> | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, seconds: number) => {
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, Math.max(0, seconds * 1000));
    timers.add(timer);
  };
  const setPhase = (next: BeatPhase) => {
    if (next === phase) return;
    phase = next;
    onPhase?.(next);
  };

  const schedule = () => {
    let t = nextTime;
    const s = step;
    if (ending && s % 4 === 0) {
      kit.play("CY", t, 1);
      kit.play("BD", t, 1);
      later(() => onPulse?.(), t - ctx.currentTime);
      later(() => setPhase("done"), t - ctx.currentTime);
      later(close, t - ctx.currentTime + 2.5);
      stopPump();
      return;
    }
    if (phase === "playing" || phase === "stalled") setPhase(t - lastTick > stallAfter(tickInterval, pace) ? "stalled" : "playing");
    if (s % 2 === 1) t += step16 * SWING;
    for (const [voice, velocity] of hitsFor(s, phase)) kit.play(voice, t, velocity);
    if (clap) kit.play("CP", t, 0.9);
    if (bell) kit.play("CB", t, 0.8);
    clap = bell = false;
    if (s % 4 === 0) later(() => onPulse?.(), t - ctx.currentTime);
    nextTime += step16;
    step = (step + 1) % 16;
  };
  const tick = () => {
    while (pump && nextTime < ctx.currentTime + LOOK_AHEAD) schedule();
  };
  const startPump = () => {
    nextTime = ctx.currentTime + 0.03;
    step = 0;
    pump = setInterval(tick, PUMP_MS);
    tick();
  };
  const stopPump = () => {
    if (pump) clearInterval(pump);
    pump = null;
  };

  function close() {
    if (closed) return;
    closed = true;
    stopPump();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    void ctx.close().catch(() => {});
  }

  return {
    event(event) {
      if (closed || event.event !== "tick") return;
      const now = ctx.currentTime;
      if (phase === "waiting") {
        lastTick = now;
        setPhase("playing");
        startPump();
      } else {
        pace = nextPace(pace, now - lastTick);
        lastTick = now;
      }
      if (event.duplicate) clap = true;
      if (event.drift) bell = true;
    },
    flush() {
      if (phase === "playing" || phase === "stalled") setPhase("flushing");
    },
    end() {
      if (closed || ending) return;
      if (phase === "waiting" || !pump) return close();
      ending = true;
    },
    setLevel(next) {
      kit.level(gainFor(next));
    },
    close,
  };
}

// ── the kit ──────────────────────────────────────────────────────────────────

/** Six square waves at inharmonic pitches: the metal under the hats, cymbal and cowbell. */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

function createKit(ctx: AudioContext, gain: number) {
  const master = ctx.createGain();
  master.gain.value = gain;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  const bus = ctx.createGain();
  bus.gain.value = 0.8;
  bus.connect(comp).connect(master).connect(ctx.destination);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const env = (t: number, peak: number, attack: number, decay: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  };
  const noiseAt = (t: number, seconds: number) => {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.start(t, Math.random() * 1.5);
    source.stop(t + seconds);
    return source;
  };
  const filter = (type: BiquadFilterType, frequency: number, q = 0.7) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  };
  const osc = (type: OscillatorType, frequency: number, t: number, seconds: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = frequency;
    o.start(t);
    o.stop(t + seconds);
    return o;
  };
  const metal = (t: number, seconds: number, pitch = 1.7) => {
    const sum = ctx.createGain();
    sum.gain.value = 0.18;
    for (const f of METAL) osc("square", f * pitch, t, seconds).connect(sum);
    return sum;
  };
  /** A closed hat cuts the open one off, as on the real thing. */
  let openHat: GainNode | null = null;

  const voices: Record<Voice, (t: number, v: number) => void> = {
    BD(t, v) {
      const body = osc("sine", 155, t, 1.2);
      body.frequency.setValueAtTime(155, t);
      body.frequency.exponentialRampToValueAtTime(47, t + 0.1);
      body.connect(env(t, 1.1 * v, 0.003, 0.95)).connect(bus);
      const click = osc("triangle", 320, t, 0.06);
      click.frequency.exponentialRampToValueAtTime(90, t + 0.04);
      click.connect(env(t, 0.35 * v, 0.001, 0.04)).connect(bus);
    },
    SD(t, v) {
      osc("triangle", 185, t, 0.3).connect(env(t, 0.4 * v, 0.002, 0.11)).connect(bus);
      osc("triangle", 330, t, 0.3).connect(env(t, 0.25 * v, 0.002, 0.11)).connect(bus);
      noiseAt(t, 0.3).connect(filter("highpass", 1800)).connect(env(t, 0.55 * v, 0.002, 0.2)).connect(bus);
    },
    CH(t, v) {
      if (openHat) {
        openHat.gain.cancelScheduledValues(t);
        openHat.gain.setTargetAtTime(0.0001, t, 0.008);
        openHat = null;
      }
      metal(t, 0.12).connect(filter("bandpass", 10000, 1)).connect(filter("highpass", 7000)).connect(env(t, 0.5 * v, 0.001, 0.045)).connect(bus);
    },
    OH(t, v) {
      const g = env(t, 0.42 * v, 0.002, 0.35);
      metal(t, 0.5).connect(filter("bandpass", 10000, 1)).connect(filter("highpass", 7000)).connect(g).connect(bus);
      openHat = g;
    },
    CP(t, v) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      for (const at of [0, 0.011, 0.022]) {
        g.gain.setValueAtTime(0.75 * v, t + at);
        g.gain.exponentialRampToValueAtTime(0.08, t + at + 0.009);
      }
      g.gain.setValueAtTime(0.6 * v, t + 0.032);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      noiseAt(t, 0.3).connect(filter("bandpass", 1150, 1.4)).connect(g).connect(bus);
    },
    CB(t, v) {
      const sum = ctx.createGain();
      sum.gain.value = 0.5;
      osc("square", 540, t, 0.45).connect(sum);
      osc("square", 800, t, 0.45).connect(sum);
      sum.connect(filter("bandpass", 1600, 1.2)).connect(env(t, 0.55 * v, 0.001, 0.32)).connect(bus);
    },
    CY(t, v) {
      metal(t, 2).connect(filter("highpass", 5500)).connect(env(t, 0.5 * v, 0.002, 1.7)).connect(bus);
      noiseAt(t, 2).connect(filter("highpass", 6500)).connect(env(t, 0.22 * v, 0.002, 1.4)).connect(bus);
    },
  };

  return {
    play: (voice: Voice, t: number, velocity: number) => voices[voice](t, velocity),
    level: (next: number) => master.gain.setTargetAtTime(next, ctx.currentTime, 0.02),
  };
}
