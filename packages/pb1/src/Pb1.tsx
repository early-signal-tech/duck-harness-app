// The PB-1 device: a drum-machine-style panel over Parkbench (the wireframe is
// ~/Desktop/pb1/pb1-wireframe.html). Knobs and switches on top set Parkbench's flags
// (settings.ts); START plays, and the 16 pads step through the run, one step per batch
// or tick (sequencer.ts).
//
// The panel is one fixed size, scaled to fit the window, like a piece of hardware. In the rack,
// `embedded` scales it to the rack's panel instead, and `onSummary` tells the rack what PB-1's
// card shows (Pb1Card). While a
// run plays its controls are held where they were, because they're the run's flags.

import { SecretsSheet, type SecretInfo } from "@dh/ui-kit";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Knob, Plate, Slide } from "./controls";
import type { Pb1Connection, Running } from "./engine";
import { Pb1Error } from "./engine";
import "./pb1.css";
import { advance, barOf, padOf, PADS, startSequence, type Sequence } from "./sequencer";
import { createPacer, type Pacer } from "./pacer";
import { BEAT_TEMPO, type BeatPhase } from "./beat";
import { createBeat, type Beat } from "./beatPlayer";
import type { RunEvent } from "./events";
import { summarize, type Pb1Summary } from "./summary";
import {
  active, BEAT_LEVEL, catalogStops, commandFor, commandLine, connectionFlags, CONVERSION, DEFAULT_SETTINGS, DISTRIBUTION, DRIFT,
  DUPLICATE, FINE, flagsFor, FLUSH, isLocal, LENGTH, LOCAL_DUCKDB, LOCAL_POSTGRES, MODES, NEW_SECRET, PARTITION, PRESCALE,
  SCHEMA, SPAN, tableName, TEMPO_BATCH, TEMPO_STREAM, USERS, variation, type Pb1Settings,
} from "./settings";

const PANEL_WIDTH = 1440;
const PANEL_HEIGHT = 896;
/** The channel strip's column width. */
const COLUMN = 114;

const PAD_COLORS = ["red", "red", "red", "red", "orange", "orange", "orange", "orange", "yellow", "yellow", "yellow", "yellow", "white", "white", "white", "white"];
const BLANK_PADS = Array.from({ length: PADS }, () => ({ mark: null, flush: false }));
const padLeft = (i: number) => 360 + i * 48 + Math.floor(i / 4) * 8;

const percent = (v: number) => `${Math.round(v * 100)}%`;
const short = (v: number) => (v >= 1_000_000 ? `${v / 1_000_000}M` : v >= 1_000 ? `${v / 1_000}k` : String(v));
const at = <T,>(list: readonly T[], value: T) => Math.max(0, list.indexOf(value));
const catalogShort = (stop: string) =>
  stop === LOCAL_DUCKDB ? "DUCK" : stop === LOCAL_POSTGRES ? "PG" : stop === NEW_SECRET ? "+NEW" : stop.replace(/^ducklake_/, "").slice(0, 6).toUpperCase();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; what: "setup" | "reset" }
  | { kind: "running"; running: Running; tap: boolean };

/** Which catalog QUERY opens a terminal on: the host does the opening. */
export type QueryCatalog = "local_duckdb" | "local_postgres" | "secret";

export function Pb1({ connection, embedded = false, onQuery, onSummary }: {
  connection: Pb1Connection;
  /** What the rack's card shows, each time it changes. */
  onSummary?: (summary: Pb1Summary) => void;
  /** Open a DuckDB terminal on a catalog, attached as wh. Without it (a plain browser) QUERY says
   *  it only works in the app. */
  onQuery?: (catalog: QueryCatalog, secret?: string) => Promise<void>;
  /** Fit the panel to its container, not the window. */
  embedded?: boolean;
}) {
  const { engine, status } = connection;
  const [s, setS] = useState<Pb1Settings>(DEFAULT_SETTINGS);
  const [secrets, setSecrets] = useState<SecretInfo[]>([]);
  const [sheet, setSheet] = useState(false);
  const [powered, setPowered] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [seq, setSeq] = useState<Sequence | null>(null);
  /** The status line when nothing is playing: what last happened. */
  const [note, setNote] = useState<string | null>(null);
  /** QUERY's result, shown for a few seconds even while a run plays. */
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashNote = (text: string) => {
    setFlash(text);
    setNote(text);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 5_000);
  };

  const set = (patch: Partial<Pb1Settings>) => {
    setS((prev) => ({ ...prev, ...patch }));
    setNote(null);
  };
  const on = active(s);
  const stream = s.mode === "STREAM";
  const running = phase.kind === "running";
  const ready = status === "ready" && !!engine && powered;

  // DuckLake secrets are catalogs. A catalog whose secret is gone falls back to local DuckDB.
  const lakeSecrets = secrets.filter((x) => x.type === "ducklake").map((x) => x.name);
  const loadSecrets = useCallback(async () => {
    if (!engine || status !== "ready") return [];
    try {
      const list = await engine.secrets.list();
      setSecrets(list);
      return list;
    } catch (e) {
      setNote(`ERROR — couldn't list secrets: ${message(e)}`);
      return [];
    }
  }, [engine, status]);
  useEffect(() => { void loadSecrets(); }, [loadSecrets]);
  useEffect(() => {
    if (!isLocal(s.catalog) && secrets.length > 0 && !lakeSecrets.includes(s.catalog)) setS((prev) => ({ ...prev, catalog: LOCAL_DUCKDB }));
  }, [secrets, lakeSecrets, s.catalog]);

  const closeSheet = async () => {
    const before = new Set(lakeSecrets);
    setSheet(false);
    const added = (await loadSecrets()).find((x) => x.type === "ducklake" && !before.has(x.name));
    if (added) set({ catalog: added.name });
  };

  const stops = catalogStops(lakeSecrets);
  const onCatalog = (i: number) => {
    if (stops[i] === NEW_SECRET) setSheet(true);
    else set({ catalog: stops[i] });
  };
  const onVariation = (i: number) => {
    if (i === 0) set({ catalog: LOCAL_DUCKDB });
    else if (lakeSecrets.length > 0) set({ catalog: lakeSecrets[0] });
    else setSheet(true);
  };

  // ── playing ──────────────────────────────────────────────────────────────────
  const stopRef = useRef<Running | null>(null);
  // A fast BATCH run may still be playing back on the pads after Parkbench has finished.
  const pacerRef = useRef<Pacer | null>(null);
  // STREAM's beat, when BEAT is on. It can be switched on or off mid-run.
  const beatRef = useRef<Beat | null>(null);
  const lampRef = useRef<HTMLSpanElement>(null);
  const [beatPhase, setBeatPhase] = useState<BeatPhase | null>(null);
  const stopBeat = () => {
    beatRef.current?.close();
    beatRef.current = null;
    setBeatPhase(null);
  };
  /** Call from a click: browsers only let a page start sound from one. */
  const startBeat = () => {
    beatRef.current?.close();
    beatRef.current = createBeat({
      tickInterval: s.tickInterval,
      level: s.beatLevel,
      onPhase: setBeatPhase,
      onPulse: () => {
        const lamp = lampRef.current;
        if (!lamp) return;
        lamp.classList.add("on");
        setTimeout(() => lamp.classList.remove("on"), 90);
      },
    });
    setBeatPhase(beatRef.current ? "waiting" : null);
  };
  const onBeat = (i: number) => {
    set({ beat: i === 1 });
    if (phase.kind !== "running" || !stream) return;
    if (i === 1) startBeat();
    else stopBeat();
  };
  const onBeatLevel = (i: number) => {
    set({ beatLevel: BEAT_LEVEL[i] });
    beatRef.current?.setLevel(BEAT_LEVEL[i]);
  };
  const play = async (tap: boolean) => {
    if (!engine || !ready) return;
    if (phase.kind === "running") {
      // STOP skips the playback to the end; a run still writing is stopped too.
      pacerRef.current?.skip();
      // The beat keeps the kick and hat going while the run flushes.
      beatRef.current?.flush();
      if (stopRef.current) await phase.running.stop();
      return;
    }
    if (phase.kind === "busy") return;
    const command = commandFor(s.mode);
    if (command !== "run") {
      setPhase({ kind: "busy", what: command });
      setNote(null);
      try {
        setNote(await (command === "setup" ? engine.setup(connectionFlags(s)) : engine.reset(connectionFlags(s))));
      } catch (e) {
        setNote(e instanceof Pb1Error && e.code === "cancelled" ? "Reset cancelled" : `ERROR — ${message(e)}`);
      } finally {
        setPhase({ kind: "idle" });
      }
      return;
    }
    setSeq(startSequence(s.prescale));
    setNote(null);
    // Only BATCH is paced: STREAM ticks already come at TEMPO, and TAP is a single batch.
    const pacer = createPacer((event) => setSeq((prev) => (prev ? advance(prev, event) : prev)),
      { prescale: s.prescale, stepMs: s.mode === "BATCH" && !tap ? undefined : 0 });
    pacerRef.current = pacer;
    if (stream && s.beat) startBeat();
    const emit = (event: RunEvent) => {
      beatRef.current?.event(event);
      if (event.event === "flush") beatRef.current?.flush();
      pacer.push(event);
    };
    const run = engine.run(flagsFor(s, { tap }), emit);
    stopRef.current = run;
    setPhase({ kind: "running", running: run, tap });
    try {
      await run.done;
      stopRef.current = null;
      // The crash on the next beat; the beat closes itself after it.
      beatRef.current?.end();
      beatRef.current = null;
      await pacer.drained();
    } catch (e) {
      pacer.skip();
      stopBeat();
      setNote(`ERROR — ${message(e)}`);
    } finally {
      stopRef.current = null;
      pacerRef.current = null;
      setBeatPhase(null);
      setPhase({ kind: "idle" });
    }
  };
  // Closing the panel stops what it started.
  useEffect(() => () => { pacerRef.current?.skip(); beatRef.current?.close(); void stopRef.current?.stop(); }, []);

  const clear = async () => {
    if (!engine || !ready || phase.kind !== "idle") return;
    setPhase({ kind: "busy", what: "reset" });
    try {
      // A reset takes only the catalog, whatever MODE is set to.
      setNote(await engine.reset(connectionFlags({ ...s, mode: "RESET" })));
    } catch (e) {
      setNote(e instanceof Pb1Error && e.code === "cancelled" ? "Reset cancelled" : `ERROR — ${message(e)}`);
    } finally {
      setPhase({ kind: "idle" });
    }
  };

  // QUERY: a DuckDB terminal on the catalog the knob points at. The local DuckDB catalog needs
  // the engine's Quack server up first, so the terminal can read it while a run writes.
  const query = async () => {
    if (!onQuery) {
      flashNote("QUERY opens a DuckDB terminal in the PB-1 app");
      return;
    }
    if (!engine || !ready) return;
    const catalog: QueryCatalog = s.catalog === LOCAL_DUCKDB ? "local_duckdb" : s.catalog === LOCAL_POSTGRES ? "local_postgres" : "secret";
    try {
      if (catalog === "local_duckdb") await engine.startQuery();
      await onQuery(catalog, catalog === "secret" ? s.catalog : undefined);
      flashNote(`QUERY — terminal opened on ${s.catalog}, attached as wh`);
    } catch (e) {
      flashNote(`ERROR — ${message(e)}`);
    }
  };

  const power = () => {
    if (powered && phase.kind === "running") {
      pacerRef.current?.skip();
      stopBeat();
      if (stopRef.current) void phase.running.stop();
    }
    setPowered(!powered);
    setNote(powered ? "Engine off" : null);
  };

  // ── the display ─────────────────────────────────────────────────────────────
  const where = `${s.catalog} · ${tableName(s)}`;
  const statusLine = (() => {
    if (status === "down") return `OFFLINE — ${connection.error ?? "the engine isn't running"}`;
    if (status === "connecting") return "Starting the engine…";
    if (flash) return flash;
    if (phase.kind === "busy") {
      return phase.what === "setup" ? `setup — creating events, events_rich, events_rejected in ${s.catalog}…` : `reset — ${s.catalog}…`;
    }
    if (running && seq) {
      const last = seq.last;
      if (!last) return `${stream ? "stream" : "batch"} starting · ${where}`;
      if (last.event === "drift") return `drift at tick ${last.tick} — ${seq.lastDrift}`;
      if (last.event === "flush") return `flushed to Parquet · ${where}`;
      if (last.event === "tick") {
        if (beatPhase === "stalled") return `STALLED — waiting for ticks · tick ${last.tick} · ${where}`;
        if (beatPhase === "flushing") return `flushing… · tick ${last.tick} · ${where}`;
        if (beatPhase === "playing") return `tick ${last.tick} · beat ${BEAT_TEMPO[s.tickInterval].bpm} BPM · ${where}`;
        return `tick ${last.tick} · ${where}`;
      }
      if (last.event === "batch") return `batch ${last.batch}${last.num_batches ? ` / ${last.num_batches}` : ""} · ${where}`;
    }
    if (note) return note;
    if (seq?.done) {
      const d = seq.done;
      // The run's own unit: the MODE knob may have moved since it ended.
      const unit = seq.unit ?? (stream ? "tick" : "batch");
      const what = `${d.rows_total.toLocaleString()} rows in ${d.steps} ${unit}${d.steps === 1 ? "" : unit === "batch" ? "es" : "s"}`;
      return d.reason === "interrupted" ? `STOPPED — ${what}` : `DONE — ${what}`;
    }
    return `READY — ${s.mode.toLowerCase()} · ${where}`;
  })();
  const command = commandLine(commandFor(s.mode), flagsFor(s));

  const summary = useMemo(() => summarize({
    settings: s, status, error: connection.error, powered, seq, statusLine, table: tableName(s), blankPads: BLANK_PADS,
    phase: phase.kind === "busy" ? phase.what : phase.kind,
  }), [s, status, connection.error, powered, seq, statusLine, phase]);
  useEffect(() => { onSummary?.(summary); }, [onSummary, summary]);

  // ── fit to the window ────────────────────────────────────────────────────────
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    // A window gets a margin round the panel; the rack's pane is already framed, so less.
    const margin = embedded ? 16 : 40;
    const fit = () => setScale(Math.min(element.clientWidth / (PANEL_WIDTH + margin), element.clientHeight / (PANEL_HEIGHT + margin)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [embedded]);

  // Space is START/STOP while the panel is on screen (in the Rack it stays mounted behind other
  // devices) and nothing that takes typing, or the secrets sheet, has the keyboard.
  const playRef = useRef(play);
  playRef.current = play;
  useEffect(() => {
    if (sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
      const element = stage.current;
      if (!element || element.getClientRects().length === 0) return;
      // Also stops Space clicking whichever control has focus.
      e.preventDefault();
      void playRef.current(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  const locked = running || phase.kind === "busy" || !powered;
  const step = seq?.step ?? 0;
  const lit = running && step > 0 ? padOf(step) : -1;
  const pads = seq?.pads ?? BLANK_PADS;
  const length = s.length === 0 ? "run forever" : `${s.length} ${stream ? "min" : s.length === 1 ? "batch" : "batches"}`;

  return (
    <div className={`pb1-stage${embedded ? " embedded" : ""}`} ref={stage} data-device="pb1">
      <div className={`pb1${powered ? "" : " unpowered"}`} style={{ width: PANEL_WIDTH, height: PANEL_HEIGHT, transform: `scale(${scale})` }}>
        <div className="pb1-face">
          <div className="pb1-power">
            <span>POWER</span>
            <button onClick={power} aria-label={powered ? "Power off" : "Power on"} aria-pressed={powered} />
            <span className={`pb1-led green${powered && status === "ready" ? " on" : ""}`} aria-hidden="true" title={connection.warning ?? undefined} />
            <span>{!powered ? "OFF" : status === "ready" ? "ON" : status === "connecting" ? "…" : "DOWN"}</span>
          </div>
          <div className="pb1-brand"><span>PB</span>Parkbench</div>
          <div className="pb1-rule" />

          <div className="pb1-left" inert={locked}>
            <div className="pb1-box" style={{ left: 8, top: 14, width: 312, height: 176 }}><span className="pb1-box-title hot">RUN MODE — CATALOG SELECT</span></div>
            <div className="pb1-box" style={{ left: 8, top: 204, width: 312, height: 76 }}><span className="pb1-box-title">CATALOG — CLEAR · QUERY</span></div>
            <Knob label="MODE" x={14} y={30} radius={26} labelled stops={MODES} value={at(MODES, s.mode)} onChange={(i) => set({ mode: MODES[i] })} />
            <Knob label="CATALOG" x={168} y={30} radius={24} labelled stops={stops.map(catalogShort)}
              // While the secrets sheet is open the knob rests on +NEW; closing it turns the knob to
              // the DuckLake secret just saved, or back to where it was.
              value={sheet ? stops.length - 1 : at(stops, s.catalog)}
              readout={sheet ? "new secret…" : s.catalog} onChange={onCatalog} flag={isLocal(s.catalog) ? "--metadata-store" : "--ducklake-secret"} />
            <button className="pb1-clear" style={{ left: 34, top: 228 }} onClick={() => void clear()} disabled={!ready} aria-label="Reset catalog" title="Reset catalog: parkbench reset" />
            <div className="pb1-clear-lab" style={{ left: 72, top: 222 }}>
              <div className="pb1-lab hot">CLEAR = RESET</div>
              <div className="pb1-lab dim">drops &amp; recreates</div>
            </div>
            {stream ? (
              <Knob key="tick" label="TEMPO · TICK" x={4} y={290} radius={44} labelled flag="--tick-interval" disabled={!on.tempo}
                stops={TEMPO_STREAM.map((v) => `${String(v).replace(/^0\./, ".")}s`)} value={at(TEMPO_STREAM, s.tickInterval)}
                readout={`1 row / ${s.tickInterval}s`} onChange={(i) => set({ tickInterval: TEMPO_STREAM[i] })} />
            ) : (
              <Knob key="batch" label="TEMPO · BATCH" x={4} y={290} radius={44} labelled flag="--batch-size" disabled={!on.tempo}
                stops={TEMPO_BATCH.map(short)} value={at(TEMPO_BATCH, s.batchSize)}
                readout={`${s.batchSize.toLocaleString()} rows`} onChange={(i) => set({ batchSize: TEMPO_BATCH[i] })} />
            )}
            <Knob label="FLUSH EVERY" x={190} y={294} radius={22} labelled flag="--flush-interval" disabled={!on.flush}
              stops={FLUSH.map((v) => (v ? String(v) : "MAN"))} value={at(FLUSH, s.flush)}
              readout={s.flush === 0 ? "never" : stream ? `end, if > ${s.flush} rows` : `${s.flush} batches`} onChange={(i) => set({ flush: FLUSH[i] })} />
            <Knob label="FINE · SPREAD" x={200} y={444} radius={14} flag="--batch-size-min/max" disabled={!on.fine}
              stops={FINE.map(String)} value={at(FINE, s.fine)} readout={s.fine ? `±${s.fine}%` : "fixed"} onChange={(i) => set({ fine: FINE[i] })} />
          </div>

          {/* QUERY sits in the CATALOG box but outside the left section, which is held while a run
              plays: reading the catalog doesn't change the run, and that's when it's most useful. */}
          <div className="pb1-left-live">
            <button className="pb1-query" style={{ left: 222, top: 218 }} onClick={() => void query()} disabled={!ready}
              title="Open a DuckDB terminal on this catalog, attached as wh">QUERY</button>
            <div className="pb1-lab dim pb1-query-lab" style={{ left: 222, top: 254 }}>duckdb ▸ wh</div>
          </div>

          <div className="pb1-channels" inert={locked}>
            <div className="pb1-ch" style={{ left: 0 }}>
              <Knob label="LEVEL" x={14} y={8} radius={17} cap="orange" flag="--duplicate-rate" disabled={!on.duplicate}
                stops={DUPLICATE.map(percent)} value={at(DUPLICATE, s.duplicateRate)} readout={percent(s.duplicateRate)} onChange={(i) => set({ duplicateRate: DUPLICATE[i] })} />
              <Plate x={7} big="DUPlicate" small="rate · stream" />
            </div>
            <div className="pb1-ch" style={{ left: COLUMN }}>
              <Knob label="LEVEL" x={14} y={8} radius={17} cap="orange" flag="--schema-drift-rate" disabled={!on.drift}
                stops={DRIFT.map(percent)} value={at(DRIFT, s.driftRate)} readout={percent(s.driftRate)} onChange={(i) => set({ driftRate: DRIFT[i] })} />
              <Plate x={7} big="DRift" small="schema · stream" />
            </div>
            <div className="pb1-ch" style={{ left: COLUMN * 2 }}>
              <Knob label="SCHEMA" x={14} y={8} radius={17} cap="orange" flag="--mode" disabled={!on.schema}
                stops={SCHEMA} value={at(SCHEMA, s.schema)} readout={s.schema} onChange={(i) => set({ schema: SCHEMA[i] })} />
              <Slide label="PAYLOAD" x={28} y={150} options={["JSON", "VAR"]} value={s.payload === "variant" ? 1 : 0} flag="--payload-type"
                disabled={!on.payload} onChange={(i) => set({ payload: i ? "variant" : "json" })} />
              <Plate x={7} big="SChema" small="--mode" />
            </div>
            <div className="pb1-ch" style={{ left: COLUMN * 3 }}>
              <Knob label="TIME" x={14} y={8} radius={17} cap="orange" flag="--distribution" disabled={!on.distribution}
                stops={DISTRIBUTION} value={at(DISTRIBUTION, s.distribution)} readout={s.distribution} onChange={(i) => set({ distribution: DISTRIBUTION[i] })} />
              <Knob label="SPAN" x={14} y={140} radius={15} cap="white" flag="--hotspot-days" disabled={!on.span}
                stops={SPAN.map(String)} value={at(SPAN, s.span)} readout={`${s.span} days`} onChange={(i) => set({ span: SPAN[i] })} />
              <Plate x={7} big="DIstrib." small="batch only" />
            </div>
            <div className="pb1-ch" style={{ left: COLUMN * 4 }}>
              <Knob label="USERS" x={14} y={8} radius={17} cap="orange" flag="--num-users" disabled={!on.users}
                stops={USERS.map(String)} value={at(USERS, s.users)} readout={s.users.toLocaleString()} onChange={(i) => set({ users: USERS[i] })} />
              <Knob label="CONVERT" x={14} y={140} radius={15} cap="white" flag="--conversion-rate" disabled={!on.conversion}
                stops={CONVERSION.map(percent)} value={at(CONVERSION, s.conversion)} readout={percent(s.conversion)} onChange={(i) => set({ conversion: CONVERSION[i] })} />
              <Plate x={7} y={248} mid big="ML Labels" />
              <Slide x={34} y={290} options={["OFF", "ON"]} value={s.mlLabels ? 1 : 0} flag="--ml-labels" disabled={!on.mlLabels}
                onChange={(i) => set({ mlLabels: i === 1 })} />
              <Plate x={7} big="USers" small="rich_ml only" />
            </div>
            <div className="pb1-ch" style={{ left: COLUMN * 5 }}>
              <Knob label="PARTITION" x={14} y={8} radius={17} cap="orange" flag="--partition-by" disabled={!on.partition}
                stops={PARTITION.map((p) => p || "none")} value={at(PARTITION, s.partition)}
                readout={(s.partition || "none").length > 12 ? `${s.partition.slice(0, 11)}…` : s.partition || "none"} onChange={(i) => set({ partition: PARTITION[i] })} />
              <Plate x={7} big="PArtition" small="batch only" />
            </div>
            <div className="pb1-ch" style={{ left: COLUMN * 6 }}>
              <Slide label="MIGRATE" x={34} y={150} options={["OFF", "ON"]} value={s.migrate ? 1 : 0} flag="--migrate" onChange={(i) => set({ migrate: i === 1 })} />
              <Plate x={7} y={248} mid big="Sink" />
              <Slide x={34} y={290} options={["LAKE", "PG"]} value={s.sink === "postgres" ? 1 : 0} flag="--data-sink" disabled={!on.sink}
                onChange={(i) => set({ sink: i ? "postgres" : "ducklake" })} />
              <Plate x={7} big="Options" />
            </div>
            <div className="pb1-ch last" style={{ left: COLUMN * 7 }}>
              <Knob label="MASTER LENGTH" x={22} y={214} radius={30} labelled flag={stream ? "--duration" : "--num-batches"} disabled={!on.length}
                stops={LENGTH.map((v) => (v ? String(v) : "∞"))} value={at(LENGTH, s.length)} readout={length} onChange={(i) => set({ length: LENGTH[i] })} />
            </div>
          </div>

          <div className="pb1-display" aria-live="polite">
            <div><label>STEP</label><b>{String(step).padStart(4, "0")}</b></div>
            <div><label>ROWS</label><b className="small">{(seq?.rows ?? 0).toLocaleString()}</b></div>
            <div><label>ROWS / SEC</label><b className="small">{Math.round(seq?.rowsPerSec ?? 0).toLocaleString()}</b></div>
            <div><label>DRIFT · DUP</label><b className="small">{seq?.drifts ?? 0} · {seq?.duplicates ?? 0}</b></div>
            <div className="pb1-msg" title={command}>{statusLine}</div>
          </div>
          {/* BEAT sits outside the held controls: it changes no flags, so it can be switched and
              turned while a stream plays. */}
          <div className={`pb1-beat${on.beat && powered ? "" : " off"}`}>
            <div className="pb1-box" style={{ left: 0, top: 0, width: 226, height: 128 }}><span className="pb1-box-title hot">BEAT — STREAM</span></div>
            <Slide name="BEAT" x={16} y={26} options={["OFF", "ON"]} value={s.beat ? 1 : 0} disabled={!on.beat || !powered} onChange={onBeat} />
            <Knob label="LEVEL" x={76} y={12} radius={17} cap="orange" disabled={!on.beat || !powered}
              stops={BEAT_LEVEL.map(percent)} value={at(BEAT_LEVEL, s.beatLevel)} readout={percent(s.beatLevel)} onChange={onBeatLevel} />
            <div className="pb1-lab pb1-beat-lab" style={{ left: 160, top: 20 }}>BEAT</div>
            <span ref={lampRef} className="pb1-led" style={{ position: "absolute", left: 182, top: 44 }} aria-hidden="true" />
            <div className="pb1-lab dim pb1-beat-lab" style={{ left: 160, top: 66 }}>{BEAT_TEMPO[s.tickInterval].bpm} BPM</div>
            <div className="pb1-lab dim pb1-beat-cap">boom bap · synthesized</div>
          </div>
          <div className="pb1-title">
            <div className="t">Benchmark Composer <em>PB-1</em></div>
            <div className="u" />
            <div className="s">Catalog Controlled</div>
          </div>

          <div className="pb1-strip">
            <div className="pb1-box" style={{ left: 14, top: 18, width: 250, height: 190 }}><span className="pb1-box-title">CATALOG VARIATION</span></div>
            <div inert={locked}>
              <Slide x={70} y={36} horizontal options={["A · LOCAL", "B · CLOUD"]} value={variation(s.catalog) === "cloud" ? 1 : 0} onChange={onVariation} />
              <Slide label="PRE-SCALE" x={282} y={50} options={PRESCALE.map(short)} value={at(PRESCALE, s.prescale)} onChange={(i) => set({ prescale: PRESCALE[i] })} />
            </div>
            <span className={`pb1-led${variation(s.catalog) === "local" ? " on" : ""}`} style={{ position: "absolute", left: 96, top: 92 }} aria-hidden="true" />
            <span className={`pb1-led${variation(s.catalog) === "cloud" ? " on" : ""}`} style={{ position: "absolute", left: 166, top: 92 }} aria-hidden="true" />
            <button className={`pb1-big${running ? " on" : ""}`} style={{ left: 62, top: 118 }} disabled={!ready || phase.kind === "busy"}
              onClick={() => void play(false)} title={running ? "Stop the run (Space)" : `${command} (Space)`}>START<br />STOP</button>

            {[0, 4, 8, 12].map((a) => (
              <div key={a} className="pb1-scale" style={{ left: padLeft(a), width: padLeft(a + 3) + 42 - padLeft(a) }} />
            ))}
            {pads.map((pad, i) => (
              <button key={i} className={`pb1-pad ${PAD_COLORS[i]}${pad.mark ? ` ${pad.mark}` : ""}${pad.flush ? " flush" : ""}`} style={{ left: padLeft(i) }}
                aria-label={`Step ${i + 1}${pad.mark ? `: ${pad.mark}` : ""}${pad.flush ? ", flushed" : ""}`}
                onClick={() => { if (!running) setNote("Pads are read-only: they light as batches and ticks land"); }}>
                <span className="n">{i + 1}</span>
                <span className={`pb1-led${i === lit ? " on" : ""}`} />
                <span className="mark" />
              </button>
            ))}
            <div className="pb1-stepno">STEP NO ➜</div>
            <div className="pb1-bar"><span className="tag">BAR</span><b>{barOf(step)}</b><span className="tag" style={{ marginLeft: 14 }}>STEP</span><b>{step || "—"}</b></div>
            <div className="pb1-legend">
              <span><i className="ok" />INSERTED</span>
              <span><i className="drift" />DRIFT</span>
              <span><i className="dup" />DUPLICATE</span>
              <span><i className="flush" />FLUSH</span>
            </div>

            <div className="pb1-box" style={{ right: 14, top: 18, width: 150, height: 190 }}><span className="pb1-box-title">ONE SHOT</span></div>
            <div className="pb1-lab pb1-tap-lab">SINGLE<br />BATCH</div>
            <button className="pb1-big small" style={{ right: 42, top: 96 }} disabled={!ready || locked || !on.tap}
              onClick={() => void play(true)} title={on.tap ? "One batch: --num-batches 1" : "TAP plays one batch, in BATCH mode"}>TAP</button>
          </div>
        </div>
      </div>
      {sheet && engine && <SecretsSheet controls={engine.secrets} adding onClose={() => void closeSheet()} />}
    </div>
  );
}
