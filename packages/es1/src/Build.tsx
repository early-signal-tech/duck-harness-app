// BUILD mode: the modules that make a pipeline, left to right. Every knob and switch moves and
// updates the draft spec, but the panel isn't connected to flowctl: a button shows what it
// would run, says nothing ran, and never pretends it worked.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CODECS, DESTINATIONS, FLUSHES, INTERVALS, LOG_LEVELS, NAMINGS, ON_CHANGES, RETENTIONS, SOURCES, SYNCS,
  destinationName, draftSpec, nextCommand, sourceName, specCount, validName,
  type AutoDiscover, type BuildState, type DraftStage, type Press,
} from "./buildSpec";
import type { Busy, Moved, Side } from "./useBuildSession";
import { BatToggle, Jack, StopKnob } from "./controls";

/** A knob's dial sits this far below its top; a toggle's pivot, this far. */
const DIAL_MARGIN = 13;
const TOGGLE_PIVOT = 26;

/** Puts a knob's center (`radius`) or a toggle's pivot at (x, y) in its module, as the wireframe
 *  lays them out. */
function At({ x, y, radius, children }: { x: number; y: number; radius?: number; children: ReactNode }) {
  const top = radius === undefined ? y - TOGGLE_PIVOT : y - radius - DIAL_MARGIN;
  return <div className="es1-at" style={{ left: x, top }}>{children}</div>;
}

function Text({ x, y, children, width }: { x: number; y: number; children: ReactNode; width?: number }) {
  return <div className="es1-at-text es1-spec" style={{ left: x, top: y, width }}>{children}</div>;
}

const labels = (list: readonly { label: string }[]) => list.map((s) => s.label);
const on = (value: boolean) => (value ? "on" : "off");
const AUTO_DISCOVER: readonly { value: AutoDiscover; label: string }[] = [
  { value: "off", label: "OFF" }, { value: "add", label: "ADD" }, { value: "evolve", label: "EVOLVE" },
];
const NOT_APPLICABLE = "doesn't apply";

interface Props {
  state: BuildState;
  onChange: (patch: Partial<BuildState>, moved: Moved) => void;
  /** Press a button that isn't connected. */
  onPress: (press: Press) => void;
  onConfig: (side: Side) => void;
  /** Press DISCOVER: starts it, or stops it if it's running. */
  onDiscover: () => void;
  discovering: boolean;
  configStatus: (side: Side) => string;
  prefix: string;
  draftStage: DraftStage;
  busy: Busy | null;
  onDraft: () => void;
  onTest: () => void;
  onDiscard: () => void;
  onPublish: () => void;
}

const OUTPUT_SCREEN: Record<DraftStage, string> = {
  none: "NOT DRAFTED",
  drafted: "DRAFTED",
  edited: "EDITED · DRAFT AGAIN",
  tested: "TEST PASSED",
  failed: "TEST FAILED",
  published: "PUBLISHED · LIVE",
};

function Name({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) {
  const ok = validName(value);
  return (
    <>
      <div className="es1-at-label es1-lab" style={{ left: 16, top: 243 }}>NAME</div>
      <input className={`es1-name-field${ok ? "" : " bad"}`} style={{ left: 58, top: 238, width: 278 }} aria-label={label}
        aria-invalid={!ok} title={ok ? value : "A catalog name looks like prefix/name"} value={value} spellCheck={false} autoComplete="off"
        onChange={(e) => onChange(e.currentTarget.value)} />
    </>
  );
}

export function BuildPanel({ state, onChange, onPress, onConfig, onDiscover, discovering, configStatus, prefix, draftStage, busy, onDraft, onTest, onDiscard, onPublish }: Props) {
  const canPublish = state.armed && draftStage === "tested" && !busy;
  const draftLed = busy === "draft" ? "running" : draftStage === "edited" ? "warn" : draftStage === "none" ? "" : "ok";
  const testLed = busy === "test" ? "running" : draftStage === "tested" ? "ok" : draftStage === "failed" ? "bad" : "";
  const steps = [
    { press: onDraft, label: busy === "draft" ? "DRAFTING…" : "DRAFT", spec: "draft create + author", led: draftLed, active: busy === "draft" },
    { press: onTest, label: busy === "test" ? "TESTING…" : "TEST", spec: "draft test", led: testLed, active: busy === "test" },
    { press: onDiscard, label: busy === "discard" ? "DISCARDING…" : "DISCARD", spec: "draft delete", led: null, active: busy === "discard" },
  ];
  const source = SOURCES[state.source];
  const destination = DESTINATIONS[state.destination];
  const onCount = state.bindings.filter((b) => b.on).length;
  const [showSpec, setShowSpec] = useState(false);
  const spec = useMemo(() => (showSpec ? JSON.stringify(draftSpec(state, prefix), null, 2) : ""), [showSpec, state, prefix]);

  useEffect(() => {
    if (!showSpec) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSpec(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSpec]);

  return (
    <>
      <section className="es1-module blue es1-b-source">
        <h2>SOURCE</h2>
        <div className="es1-b-jack" style={{ right: 23 }}><Jack label="OUT" out /></div>
        <At x={112} y={152} radius={36}>
          <StopKnob label="CONNECTOR" spec="image" radius={36} labelled stops={SOURCES.map((c) => c.stop)} value={state.source}
            onChange={(i) => onChange({ source: i }, { field: "endpoint.connector.image", value: `${SOURCES[i].image}:${SOURCES[i].tag}` })} />
        </At>
        <div className="es1-lcd" style={{ left: 220, top: 92, width: 116, height: 54 }}>
          <b>{source.stop} :{source.tag}</b><span>POSITION {state.source + 1} OF {SOURCES.length}</span>
        </div>
        <button className="es1-button white" style={{ left: 220, top: 154, width: 116, height: 40 }} onClick={() => onConfig("source")}>CONFIG</button>
        <Text x={278} y={197} width={130}>{configStatus("source")}</Text>
        <Name value={sourceName(state, prefix)} label="Source name"
          onChange={(value) => onChange({ sourceName: value }, { field: "capture name", value })} />
        <button className={`es1-lit${discovering ? " running" : ""}`} style={{ left: 30, top: 290, width: 68, height: 68 }}
          aria-label={discovering ? "Stop discovering" : "Discover"} aria-busy={discovering} onClick={onDiscover} />
        <div className="es1-at-text es1-lab" style={{ left: 64, top: 362 }}>{discovering ? "RUNNING" : "DISCOVER"}</div>
        <Text x={64} y={376} width={130}>{discovering ? "press to stop" : "flowctl discover"}</Text>
        <At x={222} y={316}>
          <BatToggle label="AUTO-DISCOVER" options={AUTO_DISCOVER} value={state.autoDiscover}
            spec="autoDiscover.addNewBindings" spec2="evolveIncompatibleCollections"
            onChange={(autoDiscover) => onChange({ autoDiscover }, { field: "autoDiscover", value: autoDiscover })} />
        </At>
        <hr style={{ left: 16, top: 408, width: 318 }} />
        <At x={62} y={462} radius={24}>
          <StopKnob label="INTERVAL" spec="interval" readout={source.batch ? undefined : "batch connectors only"} radius={24} labelled disabled={!source.batch} stops={labels(INTERVALS)} value={state.interval}
            onChange={(i) => onChange({ interval: i }, { field: "interval", value: INTERVALS[i].value })} />
        </At>
        <At x={178} y={462} radius={24}>
          <StopKnob label="LOG LEVEL" spec="shards.logLevel" radius={24} labelled stops={labels(LOG_LEVELS)} value={state.logLevel}
            onChange={(i) => onChange({ logLevel: i }, { field: "shards.logLevel", value: LOG_LEVELS[i].value })} />
        </At>
        <At x={292} y={462}>
          <BatToggle label="RUN" spec="shards.disable" value={on(state.captureOn)}
            options={[{ value: "on", label: "ON" }, { value: "off", label: "OFF" }]}
            onChange={(v) => onChange({ captureOn: v === "on" }, { field: "shards.disable", value: String(v === "off") })} />
        </At>
      </section>

      <section className="es1-module black es1-b-collection">
        <h2>COLLECTION</h2>
        <div className="es1-b-jack" style={{ left: 18 }}><Jack label="IN" /></div>
        <div className="es1-b-jack" style={{ right: 19 }}><Jack label="OUT" out /></div>
        <div className="es1-lcd" style={{ left: 92, top: 34, width: 86, height: 44 }}>
          <b>{onCount} ON</b><span>{state.bindings.length} {state.found ? "FOUND" : "EXAMPLE"}</span>
        </div>
        <div className="es1-bindings" style={{ left: 16, top: 90, width: 238 }}>
          {state.bindings.map((b, i) => (
            <button key={b.target ?? b.table} role="switch" aria-checked={b.on} aria-label={b.table} className={`es1-binding${b.on ? " on" : ""}`}
              onClick={() => onChange(
                { bindings: state.bindings.map((x, n) => (n === i ? { ...x, on: !x.on } : x)) },
                { field: `bindings[${b.table}].disable`, value: String(b.on) },
              )}>
              <span className="es1-slide"><i /></span>
              <span className={`es1-led${b.on ? " lit" : ""}`} aria-hidden="true" />
              <span className="es1-binding-name" title={b.target}>{b.table}</span>
            </button>
          ))}
        </div>
        <Text x={135} y={268} width={250}>{state.found ? "bindings[].disable" : "bindings[].disable · examples until DISCOVER"}</Text>
        <hr style={{ left: 16, top: 288, width: 238 }} />
        <Text x={135} y={298} width={240}>journals.fragments</Text>
        <At x={48} y={356} radius={22}>
          <StopKnob label="CODEC" spec="compressionCodec" radius={22} labelled stops={labels(CODECS)} value={state.codec}
            onChange={(i) => onChange({ codec: i }, { field: "journals.fragments.compressionCodec", value: CODECS[i].value })} />
        </At>
        <At x={135} y={356} radius={22}>
          <StopKnob label="FLUSH" spec="flushInterval" radius={22} labelled stops={labels(FLUSHES)} value={state.flush}
            onChange={(i) => onChange({ flush: i }, { field: "journals.fragments.flushInterval", value: FLUSHES[i].value })} />
        </At>
        <At x={222} y={356} radius={22}>
          <StopKnob label="RETAIN" spec="retention" radius={22} labelled stops={labels(RETENTIONS)} value={state.retain}
            onChange={(i) => onChange({ retain: i }, { field: "journals.fragments.retention", value: RETENTIONS[i].value ?? "keep everything" })} />
        </At>
        <hr style={{ left: 16, top: 448, width: 238 }} />
        <button className="es1-button" style={{ left: 16, top: 466, width: 113, height: 40 }} onClick={() => onPress("new")}>+ NEW</button>
        <button className="es1-button" style={{ left: 141, top: 466, width: 113, height: 40 }} onClick={() => onPress("read")}>READ</button>
        <Text x={72} y={512} width={113}>key + schema</Text>
        <Text x={197} y={512} width={113}>collections read</Text>
      </section>

      <section className="es1-module green es1-b-materialization">
        <h2>MATERIALIZATION</h2>
        <div className="es1-b-jack" style={{ left: 18 }}><Jack label="IN" /></div>
        <At x={112} y={152} radius={36}>
          <StopKnob label="DESTINATION" spec="image" radius={36} labelled stops={DESTINATIONS.map((c) => c.stop)} value={state.destination}
            onChange={(i) => onChange({ destination: i }, { field: "endpoint.connector.image", value: `${DESTINATIONS[i].image}:${DESTINATIONS[i].tag}` })} />
        </At>
        <div className="es1-lcd" style={{ left: 220, top: 92, width: 116, height: 54 }}>
          <b>{destination.stop} :{destination.tag}</b><span>POSITION {state.destination + 1} OF {DESTINATIONS.length}</span>
        </div>
        <button className="es1-button white" style={{ left: 220, top: 154, width: 116, height: 40 }} onClick={() => onConfig("destination")}>CONFIG</button>
        <Text x={278} y={197} width={130}>{configStatus("destination")}</Text>
        <Name value={destinationName(state, prefix)} label="Destination name"
          onChange={(value) => onChange({ destinationName: value }, { field: "materialization name", value })} />
        <At x={58} y={316} radius={24}>
          <StopKnob label="SYNC" spec="syncFrequency" readout={destination.sync ? undefined : NOT_APPLICABLE} radius={24} labelled disabled={!destination.sync} stops={labels(SYNCS)} value={state.sync}
            onChange={(i) => onChange({ sync: i }, { field: "syncSchedule.syncFrequency", value: SYNCS[i].value })} />
        </At>
        <At x={168} y={316} radius={24}>
          <StopKnob label="ON CHANGE" spec="onIncompatible" readout="SchemaChange" radius={24} labelled stops={labels(ON_CHANGES)} value={state.onChange}
            onChange={(i) => onChange({ onChange: i }, { field: "onIncompatibleSchemaChange", value: ON_CHANGES[i].value })} />
        </At>
        <At x={280} y={316} radius={24}>
          <StopKnob label="NAMING" spec="source.targetNaming" readout={destination.naming ? undefined : NOT_APPLICABLE} radius={24} labelled
            disabled={!destination.naming} stops={labels(NAMINGS)} value={state.naming}
            onChange={(i) => onChange({ naming: i }, { field: "source.targetNaming", value: NAMINGS[i].value })} />
        </At>
        <hr style={{ left: 16, top: 408, width: 318 }} />
        <At x={58} y={462}>
          <BatToggle label="DELTA" spec={destination.delta ? "source.deltaUpdates" : NOT_APPLICABLE} disabled={!destination.delta} value={on(state.delta)}
            options={[{ value: "off", label: "OFF" }, { value: "on", label: "ON" }]}
            onChange={(v) => onChange({ delta: v === "on" }, { field: "source.deltaUpdates", value: String(v === "on") })} />
        </At>
        <At x={168} y={462}>
          <BatToggle label="FIELDS" spec="source.fields" spec2="Recommended" value={on(state.fields)}
            options={[{ value: "off", label: "OFF" }, { value: "on", label: "REC" }]}
            onChange={(v) => onChange({ fields: v === "on" }, { field: "source.fieldsRecommended", value: String(v === "on") })} />
        </At>
        <At x={280} y={462}>
          <BatToggle label="RUN" spec="shards.disable" value={on(state.materializationOn)}
            options={[{ value: "on", label: "ON" }, { value: "off", label: "OFF" }]}
            onChange={(v) => onChange({ materializationOn: v === "on" }, { field: "shards.disable", value: String(v === "off") })} />
        </At>
      </section>

      <section className="es1-module black es1-b-output">
        <h2>OUTPUT</h2>
        <button className="es1-lcd as-button" style={{ left: 16, top: 40, width: 188, height: 50 }} onClick={() => setShowSpec(true)} title="See the draft spec">
          <b>{OUTPUT_SCREEN[draftStage]}</b><span>SEE SPEC · {specCount(state)} SPECS</span>
        </button>
        {steps.map((s, i) => (
          <div key={s.spec}>
            <button className="es1-button" style={{ left: 16, top: 106 + i * 74, width: 126, height: 36 }} aria-busy={s.active}
              disabled={!!busy && !s.active} title={s.active ? "Press to stop" : undefined} onClick={s.press}>{s.label}</button>
            {s.led !== null && <span className={`es1-led es1-abs ${s.led}`} style={{ left: 158, top: 119 + i * 74 }}
              role="img" aria-label={`${s.spec}: ${s.led === "ok" ? "done" : s.led === "bad" ? "failed" : s.led === "warn" ? "out of date" : s.led === "running" ? "running" : "not yet"}`} />}
            <div className="es1-at-left es1-spec" style={{ left: 16, top: 146 + i * 74 }}>{s.spec}</div>
          </div>
        ))}
      </section>

      <section className="es1-module red es1-b-golive">
        <h2>GO LIVE</h2>
        <At x={58} y={92}>
          <BatToggle label="" value={state.armed ? "arm" : "safe"}
            options={[{ value: "safe", label: "SAFE" }, { value: "arm", label: "ARM" }]}
            onChange={(v) => onChange({ armed: v === "arm" }, { field: "GO LIVE", value: v === "arm" ? "armed" : "safe" })} />
        </At>
        <button className={`es1-publish${canPublish ? " armed" : ""}`} style={{ left: 116, top: 58, width: 84, height: 84 }}
          disabled={!canPublish} aria-busy={busy === "publish"} onClick={onPublish}
          title={canPublish ? "Publish: you'll be asked to confirm" : state.armed ? "TEST has to pass first" : "Flip to ARM first"}>
          {busy === "publish" ? "PUBLISHING…" : "PUBLISH"}
        </button>
        <div className="es1-at-left es1-spec" style={{ left: 16, top: 156, opacity: 1 }}>draft publish, after TEST passes.</div>
        <div className="es1-at-left es1-spec" style={{ left: 16, top: 170, opacity: 1 }}>This one makes it live.</div>
      </section>

      {/* Patch cables hang between the jacks and cast a shadow on the panel below them. */}
      <svg className="es1-patch" width="1440" height="724" viewBox="0 0 1440 724" aria-hidden="true">
        <defs>
          <filter id="es1-cable-shadow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="2.4" /></filter>
          <radialGradient id="es1-plug" cx="40%" cy="35%" r="70%">
            <stop offset="0" stopColor="#4a4a48" /><stop offset=".7" stopColor="#161615" /><stop offset="1" stopColor="#050505" />
          </radialGradient>
          <radialGradient id="es1-plug-tip" cx="40%" cy="35%" r="70%">
            <stop offset="0" stopColor="#ffd2a0" /><stop offset=".6" stopColor="#ff8a2a" /><stop offset="1" stopColor="#b5520f" />
          </radialGradient>
        </defs>
        {[[522, 56, 606, 56], [804, 56, 884, 56]].map(([x1, y1, x2, y2]) => {
          const d = `M${x1} ${y1} C${x1 + 30} ${y1 + 62}, ${x2 - 30} ${y2 + 62}, ${x2} ${y2}`;
          return (
            <g key={x1}>
              <path d={d} transform="translate(2 7)" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="6" strokeLinecap="round" filter="url(#es1-cable-shadow)" />
              <path d={d} fill="none" stroke="#3a1704" strokeWidth="6.5" strokeLinecap="round" />
              <path d={d} fill="none" stroke="#ff8a2a" strokeWidth="4.5" strokeLinecap="round" />
              <path d={d} transform="translate(-0.6 -1.1)" fill="none" stroke="rgba(255,226,190,0.65)" strokeWidth="1.1" strokeLinecap="round" />
              {[[x1, y1], [x2, y2]].map(([cx, cy]) => (
                <g key={cx}>
                  <circle cx={cx + 1} cy={cy + 3} r="10" fill="rgba(0,0,0,0.45)" filter="url(#es1-cable-shadow)" />
                  <circle cx={cx} cy={cy} r="9.5" fill="url(#es1-plug)" stroke="#000" strokeWidth=".8" />
                  <circle cx={cx} cy={cy} r="4.6" fill="url(#es1-plug-tip)" stroke="#5a2606" strokeWidth=".6" />
                </g>
              ))}
            </g>
          );
        })}
      </svg>

      {showSpec && (
        <div className="es1-spec-view" role="dialog" aria-label="Draft spec">
          <header>
            <b>DRAFT SPEC</b>
            <span>What the controls add up to. Nothing has been sent to Estuary.</span>
            <button className="es1-button" onClick={() => setShowSpec(false)} autoFocus>CLOSE</button>
          </header>
          <pre>{spec}</pre>
        </div>
      )}
    </>
  );
}

const RUNNING: Record<Busy, (state: BuildState, profile: string) => [string, string]> = {
  discover: (state, profile) => [nextCommand({ ...state, found: false }, profile), "5 minutes"],
  draft: (state, profile) => [nextCommand(state, profile), "a minute"],
  test: (state, profile) => [nextCommand(state, profile, "drafted"), "a few minutes"],
  discard: (_, profile) => [`flowctl --profile ${profile} draft delete`, "a moment"],
  publish: (state, profile) => [nextCommand(state, profile, "tested"), "a few minutes"],
};

export function BuildStrip({ state, profile, moved, rehearsal, busy, stage }: { state: BuildState; profile: string; moved: Moved | null; rehearsal: string | null; busy: Busy | null; stage: DraftStage }) {
  if (busy) {
    const [command, takes] = RUNNING[busy](state, profile);
    return <><b>RUNNING</b><code title={command}>{command}</code><i /><b>TAKES UP TO</b><code className="es1-strip-end">{takes}</code></>;
  }
  if (rehearsal) {
    return (
      <>
        <b>WOULD RUN</b><code title={rehearsal}>{rehearsal}</code>
        <i />
        <b>NOT CONNECTED</b><code className="es1-strip-end">nothing ran</code>
      </>
    );
  }
  const next = nextCommand(state, profile, stage);
  return (
    <>
      <b>NEXT</b><code title={next}>{next}</code>
      <i />
      {moved && <><b>LAST MOVED</b><code className="es1-strip-end" title={`${moved.field}: ${moved.value}`}>{moved.field}: {moved.value}</code></>}
    </>
  );
}

