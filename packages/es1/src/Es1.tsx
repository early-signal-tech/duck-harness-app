// The ES-1 device: a panel of modules, left to right, the way a signal runs through it.
// BUILD (Build.tsx) makes a pipeline, and isn't connected to flowctl yet. MAP reads what's
// live with `catalog list` and changes nothing. LOGS is on the MODE switch but can't be
// chosen yet.
//
// The panel is one fixed size, scaled to fit the window, like a piece of hardware. The rows
// of MAP scroll together, so a cable stays attached to what it joins.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { count, layoutMap, parseCatalog, prefixes, sharedPrefix, withPrefix, type CatalogRow, type Health, type Spec } from "./catalog";
import { BuildPanel, BuildStrip, type Moved } from "./Build";
import { DATA_PLANES, INITIAL_BUILD, pressed, type BuildState, type Press } from "./buildSpec";
import { BatToggle, Jack, StopKnob } from "./controls";
import { EngineError } from "./engine";
import "./es1.css";
import { LoginDrawer } from "./Login";
import type { EngineConnection } from "./useEngine";

const PANEL_WIDTH = 1440;
const PANEL_HEIGHT = 724;

// Where MAP's rows sit in the shared scrolling field (see .es1-field in es1.css).
const ROW_STEP = 68;
const ROW_HEIGHT = 58;
const SOURCE = { x: 14, width: 222 };
const COLLECTION = { x: 324, width: 264 };
const MATERIALIZATION = { x: 680, width: 300 };

const PROFILE_KEY = "es1.profile";
const DEFAULT_PROFILE = "default";

function loadProfile(): string {
  try {
    return localStorage.getItem(PROFILE_KEY) || DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

function saveProfile(profile: string): void {
  try {
    localStorage.setItem(PROFILE_KEY, profile);
  } catch {
    // Not remembered, then: it's still used until the app closes.
  }
}

const HEALTH_LABEL: Record<Health, string> = { ok: "OK", alert: "Alert", failing: "Failing", disabled: "Disabled" };

/** The snapshot's path from the Snapshots folder on: the rest of it doesn't fit, or help. */
const shortSnapshot = (path: string) => path.slice(path.lastIndexOf("Snapshots/"));

function TaskRow({ spec, left, width, row, hide, dark }: { spec: Spec; left: number; width: number; row: number; hide: string; dark?: boolean }) {
  return (
    <div className={`es1-row${spec.health === "disabled" ? " off" : ""}${dark ? " dark" : ""}`} style={{ left, width, top: row * ROW_STEP, height: ROW_HEIGHT }}>
      <i className={`es1-status ${spec.health}`} role="img" aria-label={HEALTH_LABEL[spec.health]} title={HEALTH_LABEL[spec.health]} />
      {spec.derived && <i className="es1-tag">DERIVED</i>}
      <b title={spec.name} className={spec.derived ? "tagged" : undefined}>{spec.name.slice(hide.length)}</b>
      <span title={spec.summary}>{spec.summary}</span>
    </div>
  );
}

function CollectionRow({ spec, row, hide }: { spec: Spec; row: number; hide: string }) {
  if (spec.derived) return <TaskRow spec={spec} left={COLLECTION.x} width={COLLECTION.width} row={row} hide={hide} dark />;
  return (
    <div className="es1-row dark plain" style={{ left: COLLECTION.x, width: COLLECTION.width, top: row * ROW_STEP, height: ROW_HEIGHT }}>
      <b title={spec.name}>{spec.name.slice(hide.length)}</b>
      <span>Written by {spec.writtenBy.length} · read by {spec.readBy.length}</span>
    </div>
  );
}

function Cables({ specs, rows }: { specs: ReturnType<typeof layoutMap>; rows: number }) {
  const mid = (row: number) => row * ROW_STEP + ROW_HEIGHT / 2;
  const sourceRight = SOURCE.x + SOURCE.width;
  const collectionLeft = COLLECTION.x;
  const collectionRight = COLLECTION.x + COLLECTION.width;
  const destinationLeft = MATERIALIZATION.x;
  const span = (x1: number, y1: number, x2: number, y2: number) => {
    const m = (x1 + x2) / 2;
    return `M${x1} ${y1} C${m} ${y1}, ${m} ${y2}, ${x2} ${y2}`;
  };
  return (
    <svg className="es1-cables" width="994" height={Math.max(rows * ROW_STEP, 1)} aria-hidden="true">
      {specs.cables.map((cable, i) => {
        const ends = cable.kind === "capture"
          ? { x1: sourceRight, y1: mid(cable.fromRow), x2: collectionLeft, y2: mid(cable.toRow) }
          : cable.kind === "materialization"
            ? { x1: collectionRight, y1: mid(cable.fromRow), x2: destinationLeft, y2: mid(cable.toRow) }
            : { x1: collectionLeft, y1: mid(cable.fromRow), x2: collectionLeft, y2: mid(cable.toRow) };
        const d = cable.kind === "derivation"
          ? `M${ends.x1} ${ends.y1} C${ends.x1 - 30} ${ends.y1}, ${ends.x2 - 30} ${ends.y2}, ${ends.x2} ${ends.y2}`
          : span(ends.x1, ends.y1, ends.x2, ends.y2);
        return (
          <g key={i} strokeDasharray={cable.dashed ? "7 6" : undefined}>
            <path d={d} fill="none" stroke="#0a0a0a" strokeWidth="6" strokeLinecap="round" />
            <path d={d} fill="none" stroke="#ff8a2a" strokeWidth="3" strokeLinecap="round" />
            <circle cx={ends.x1} cy={ends.y1} r="5" className="es1-plug" />
            <circle cx={ends.x2} cy={ends.y2} r="5" className="es1-plug" />
          </g>
        );
      })}
    </svg>
  );
}

function Count({ label, value, bad }: { label: string; value: number | null; bad?: boolean }) {
  return (
    <div className={`es1-count${bad ? " bad" : ""}`}>
      <span>{label}</span>
      <b>{value ?? "–"}</b>
    </div>
  );
}

const KEY: { health: Health; label: string }[] = [
  { health: "ok", label: "OK" },
  { health: "alert", label: "ALERT" },
  { health: "failing", label: "FAILING" },
  { health: "disabled", label: "DISABLED" },
];

const MODES = [
  { value: "build", label: "BUILD" },
  { value: "map", label: "MAP" },
  { value: "logs", label: "LOGS", disabled: "Live logs come in a later build." },
] as const;

interface Reading {
  specs: Spec[];
  at: Date;
  snapshot: string | null;
  truncated: boolean;
  badLines: number;
}

export function Es1({ connection, settings }: { connection: EngineConnection; settings?: ReactNode }) {
  const { engine, status, hello, error: engineError } = connection;
  const [profile, setProfile] = useState(loadProfile);
  const [profileDraft, setProfileDraft] = useState(profile);
  const [prefix, setPrefix] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<{ text: string; code?: string } | null>(null);
  const [mode, setMode] = useState<"build" | "map">("build");
  const [build, setBuild] = useState<BuildState>(INITIAL_BUILD);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [rehearsal, setRehearsal] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  // Only the newest read counts: changing profile mid-read mustn't show the old one's tasks.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    if (!engine) return;
    const read = ++latest.current;
    setLoading(true);
    try {
      const result = await engine.once<CatalogRow>("catalog_list", {}, profile);
      if (read !== latest.current) return;
      setReading({
        specs: parseCatalog(result.rows),
        at: new Date(),
        snapshot: result.snapshot,
        truncated: result.truncated,
        badLines: result.bad_lines,
      });
      setProblem(null);
    } catch (e) {
      if (read !== latest.current) return;
      setProblem({ text: e instanceof Error ? e.message : String(e), code: e instanceof EngineError ? e.code : undefined });
    } finally {
      if (read === latest.current) setLoading(false);
    }
  }, [engine, profile]);

  useEffect(() => {
    if (status === "ready") void refresh();
  }, [status, refresh]);

  const applyProfile = () => {
    const next = profileDraft.trim() || DEFAULT_PROFILE;
    setProfileDraft(next);
    if (next === profile) return;
    saveProfile(next);
    setReading(null);
    setPrefix(null);
    setProfile(next);
  };

  const allSpecs = reading?.specs ?? [];
  const available = useMemo(() => prefixes(allSpecs), [allSpecs]);
  const stops = useMemo(() => ["ALL", ...available], [available]);
  const shown = useMemo(() => withPrefix(allSpecs, prefix), [allSpecs, prefix]);
  const layout = useMemo(() => layoutMap(shown), [shown]);
  const hide = useMemo(() => sharedPrefix(allSpecs, prefix), [allSpecs, prefix]);
  const counts = reading ? count(shown) : null;
  const prefixStop = prefix === null ? 0 : Math.max(0, stops.indexOf(prefix));
  // New specs go under the prefix on the knob, else the first one this login has.
  const buildPrefix = prefix ?? available[0] ?? "your_prefix/";
  const moveBuild = (patch: Partial<BuildState>, change: Moved) => {
    setBuild((b) => ({ ...b, ...patch }));
    setMoved(change);
    setRehearsal(null);
  };
  const press = (button: Press) => setRehearsal(pressed(button, build, buildPrefix, profile));

  // The whole panel scales to fit the window.
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const fit = () => setScale(Math.min(element.clientWidth / PANEL_WIDTH, element.clientHeight / PANEL_HEIGHT));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const loggedOut = problem?.code === "not_logged_in";
  const tool = hello?.tool;
  const stripProblem = status === "down"
    ? `The flowctl bridge isn't running${engineError ? `: ${engineError}` : "."}`
    : loggedOut
      ? `Not logged in as "${profile}". Press LOGIN to log in.`
      : problem?.text ?? (reading?.truncated ? "Too many specs to read them all: this shows the first part." : null);

  return (
    <div className="es1-stage" ref={stage}>
      <div className="es1" style={{ width: PANEL_WIDTH, height: PANEL_HEIGHT, transform: `scale(${scale})` }}>
        <section className="es1-module yellow es1-session">
          <h2>SESSION</h2>
          <div className="es1-login">
            <span className={`es1-led${reading && !loggedOut ? " on" : ""}`} role="img"
              aria-label={reading && !loggedOut ? "Logged in" : "Not logged in"} />
            <button className="es1-button" disabled={status !== "ready"} onClick={() => setLoggingIn(true)}>LOGIN</button>
          </div>
          <span className="es1-spec">flowctl auth login</span>
          <hr />
          <form className="es1-profile" onSubmit={(e) => { e.preventDefault(); applyProfile(); }}>
            <label htmlFor="es1-profile" className="es1-lab">PROFILE</label>
            <span className="es1-spec">--profile</span>
            <input id="es1-profile" value={profileDraft} spellCheck={false} autoComplete="off"
              onChange={(e) => setProfileDraft(e.currentTarget.value)} onBlur={applyProfile} />
          </form>
          <StopKnob label="PREFIX" spec="--prefix" stops={stops} value={prefixStop} readout={stops[prefixStop]}
            onChange={(i) => setPrefix(i === 0 ? null : stops[i])} />
          {mode === "build" ? (
            <StopKnob label="DATA PLANE" spec="--init-data-plane" stops={DATA_PLANES} value={build.dataPlane} readout={DATA_PLANES[build.dataPlane]}
              onChange={(i) => moveBuild({ dataPlane: i }, { field: "--init-data-plane", value: DATA_PLANES[i] })} />
          ) : (
            <StopKnob label="DATA PLANE" spec="used in BUILD" stops={DATA_PLANES} value={build.dataPlane} disabled />
          )}
          <hr />
          <BatToggle label="MODE" options={MODES} value={mode} onChange={(m) => { if (m !== "logs") setMode(m); }} />
        </section>

        {mode === "build" && <BuildPanel state={build} onChange={moveBuild} onPress={press} prefix={buildPrefix} />}

        {mode === "map" && <>
        <section className="es1-module blue es1-source">
          <h2>SOURCE</h2>
          <div className="es1-jacks end"><Jack label="OUT" out /></div>
        </section>
        <section className="es1-module black es1-collection">
          <h2>COLLECTION</h2>
          <div className="es1-jacks"><Jack label="IN" /><Jack label="OUT" out /></div>
        </section>
        <section className="es1-module green es1-materialization">
          <h2>MATERIALIZATION</h2>
          <div className="es1-jacks"><Jack label="IN" /></div>
        </section>

        <div className="es1-field">
          <div className="es1-field-rows" style={{ height: layout.rows * ROW_STEP }}>
            {layout.noCapture.map((row) => (
              <div key={row} className="es1-socket" style={{ left: SOURCE.x, width: SOURCE.width, top: row * ROW_STEP, height: ROW_HEIGHT }}>NO CAPTURE LISTED</div>
            ))}
            {layout.captures.map(({ spec, row }) => <TaskRow key={spec.name} spec={spec} left={SOURCE.x} width={SOURCE.width} row={row} hide={hide} />)}
            {layout.collections.map(({ spec, row }) => <CollectionRow key={spec.name} spec={spec} row={row} hide={hide} />)}
            {layout.materializations.map(({ spec, row }) => <TaskRow key={spec.name} spec={spec} left={MATERIALIZATION.x} width={MATERIALIZATION.width} row={row} hide={hide} />)}
            <Cables specs={layout} rows={layout.rows} />
          </div>
          {reading && layout.rows === 0 && <p className="es1-empty">No captures, collections or materializations here.</p>}
          {!reading && loading && <p className="es1-empty">Reading the catalog…</p>}
        </div>

        <section className="es1-module black es1-readout-module">
          <h2>READOUT</h2>
          <div className="es1-counts">
            <Count label="TASKS" value={counts?.tasks ?? null} />
            <Count label="OK" value={counts?.ok ?? null} />
            <Count label="ALERT" value={counts?.alert ?? null} />
            <Count label="FAILING" value={counts?.failing ?? null} bad />
            <Count label="DISABLED" value={counts?.disabled ?? null} />
            <Count label="COLLECTIONS" value={counts?.collections ?? null} />
          </div>
          <hr />
          <ul className="es1-key">
            {KEY.map((k) => <li key={k.health}><i className={`es1-status ${k.health}`} aria-hidden="true" />{k.label}</li>)}
          </ul>
          <hr />
          <button className="es1-button wide" disabled={status !== "ready" || loading} onClick={() => void refresh()}>
            {loading ? "READING…" : "REFRESH"}
          </button>
          <span className="es1-spec">catalog list --flows</span>
          {reading && <span className="es1-spec es1-read-at">READ {reading.at.toISOString().slice(11, 19)} UTC</span>}
        </section>
        </>}

        {loggingIn && engine && (
          <LoginDrawer engine={engine} profile={profile} onClose={() => setLoggingIn(false)}
            onLoggedIn={() => { setLoggingIn(false); void refresh(); }} />
        )}

        <div className={`es1-strip${stripProblem ? " problem" : ""}`}>
          {stripProblem ? (
            <><b>{status === "down" ? "OFFLINE" : "PROBLEM"}</b><code title={stripProblem}>{stripProblem}</code></>
          ) : mode === "build" ? (
            <BuildStrip state={build} profile={profile} moved={moved} rehearsal={rehearsal} />
          ) : (
            <>
              <b>LAST RUN</b><code>flowctl --profile {profile} catalog list --flows -o json</code>
              <i />
              {reading?.snapshot && <><b>SAVED</b><code title={reading.snapshot}>{shortSnapshot(reading.snapshot)}</code></>}
            </>
          )}
        </div>

        <footer className="es1-name">
          <span className="es1-word">ES-1</span>
          <span className="es1-desc">STREAMING PIPELINE<br />INSTRUMENT</span>
          <i />
          {tool && (
            <span className={`es1-stat${tool.status === "tested" ? "" : " warn"}`} title={tool.warning ?? undefined}>
              <em>FLOWCTL</em>
              {tool.status === "missing" ? "NOT FOUND" : `v${tool.version ?? "?"} · ${tool.status.toUpperCase()}`}
            </span>
          )}
          {settings}
          <span className="es1-stat" title={engineError ?? undefined}>
            <span className={`es1-led${status === "ready" ? " on" : status === "down" ? " bad" : ""}`} aria-hidden="true" />
            {status === "ready" ? "ENGINE" : status === "connecting" ? "STARTING" : "OFFLINE"}
          </span>
        </footer>
      </div>
    </div>
  );
}
