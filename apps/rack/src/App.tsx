// The Rack (v3): a transport across the top, one big panel, and a compact rack of devices
// along the bottom, like Bitwig's device chain.
//
// - The TRANSPORT plays the chain: the prompt, RUN / A/B / SETLIST, PLAY and STOP.
// - The PANEL shows the chain's output (the latest take) or, when a device is opened, its
//   full editor; ✕ goes back to the output.
// - The RACK holds the chain as narrow cards: DH-1, AUTO-GRADE, EH-1. Each card's tiles
//   open its editor at a section; double-click a card's strip to collapse it.
//
// Each device is one model (useDh1, useEh1) kept here, drawn by several views (card,
// editor, output), so a device keeps running whatever is on screen.

import { Dh1Card, Dh1Face, Dh1Output, useDh1, useEngine as useDh1Engine, type Dh1Section } from "@dh/dh1";
import { Eh1Card, Eh1Face, FOLLOW_IDLE, useEh1, useEngine as useEh1Engine, type FollowStatus } from "@dh/eh1";
import { engineProblems, SettingsMenu, tauriTransport, useAppearance, type TracesControls } from "@dh/ui-kit";
import { useEffect, useMemo, useState } from "react";
import { AutoGradeCard } from "./AutoGradeCard";
import { combinedStatus, loadLayout, saveLayout, toggleCollapsed, type Open } from "./rackLayout";
import { Transport } from "./Transport";
import "./rack.css";

// The engines, as the host crate names them.
const dh1Transport = tauriTransport("dh1");
const eh1Transport = tauriTransport("eh1");

const TITLES: Record<Exclude<Open, "output">, [string, string]> = {
  dh1: ["DH-1", "ANALYTICS AGENT"],
  eh1: ["EH-1", "EVALUATOR"],
};

/** A + slot between devices: where more devices will go. Nothing else can go there yet. */
function Slot() {
  return <button className="rack-slot" disabled title="Add a device here (more devices are coming)" aria-label="Add a device">+</button>;
}

export default function App() {
  const [appearance, setAppearance] = useAppearance();
  const dh1Engine = useDh1Engine(dh1Transport);
  const eh1Engine = useEh1Engine(eh1Transport);

  const [layout, setLayout] = useState(loadLayout);
  useEffect(() => saveLayout(layout), [layout]);
  const open = (target: Open) => setLayout((l) => ({ ...l, open: target }));
  const collapse = (device: string) => () => setLayout((l) => toggleCollapsed(l, device));

  // AUTO-GRADE starts off every time the rack opens: grading costs money.
  const [autoGrade, setAutoGrade] = useState(false);
  const [follow, setFollow] = useState<FollowStatus>(FOLLOW_IDLE);
  const chain = useMemo(() => ({ autoGrade, onFollow: setFollow }), [autoGrade]);

  // The devices' models live here, so they keep working whatever the panel shows.
  const dh1 = useDh1(dh1Engine);
  const eh1 = useEh1(eh1Engine, chain);

  // What the panel's output shows: the last take PLAY made, and what it asked.
  const [lastTake, setLastTake] = useState(layout.take);
  const [lastPrompt, setLastPrompt] = useState("");
  const shownTake = dh1.setlist.busy ? "setlist" : lastTake;
  // Where DH-1's editor opens: at a section (a tile), or on the Setlist (PLAY with SETLIST).
  const [dh1Focus, setDh1Focus] = useState<{ section: Dh1Section | null; setlist: boolean; n: number }>({ section: null, setlist: false, n: 0 });
  const openDh1 = (section?: Dh1Section, setlist = false) => {
    setDh1Focus((f) => ({ section: section ?? null, setlist, n: f.n + 1 }));
    open("dh1");
  };

  const play = () => {
    if (layout.take === "setlist") {
      // The setlist's questions and presets are set up in DH-1's Setlist, which starts it.
      openDh1(undefined, true);
      return;
    }
    setLastTake(layout.take);
    setLastPrompt(dh1.settings.prompt);
    if (layout.take === "ab") dh1.startBoth();
    else dh1.start();
  };

  // DH-1's agent runs the traces server, so Settings manages it through DH-1's engine.
  const harness = dh1Engine.harness;
  const traces = useMemo<TracesControls | undefined>(() => harness
    ? { info: () => harness.traces(), stop: () => harness.tracesStop(), reset: () => harness.tracesReset() }
    : undefined, [harness]);

  // Settings are the host's: the key and the traces file apply to both engines, so a
  // change restarts both.
  const { status: dh1Status, restart: restartDh1, hello: dh1Hello } = dh1Engine;
  const { status: eh1Status, restart: restartEh1, hello: eh1Hello } = eh1Engine;
  const settingsEngine = useMemo(() => ({
    status: combinedStatus([dh1Status, eh1Status]),
    restart: async () => {
      await Promise.all([restartDh1(), restartEh1()]);
    },
    versions: { dh1: dh1Hello?.version, eh1: eh1Hello?.version },
  }), [dh1Status, eh1Status, restartDh1, restartEh1, dh1Hello, eh1Hello]);

  // The grader reads what the agent writes: both must be built for the same traces.
  const problems = dh1Hello && eh1Hello
    ? engineProblems([
      { engine: "dh1", version: dh1Hello.version, traces_schema: dh1Hello.traces_schema },
      { engine: "eh1", version: eh1Hello.version, traces_schema: eh1Hello.traces_schema },
    ])
    : [];

  // The panel's header: a device's name and its own controls (its toolbar slot), or OUTPUT.
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const judge = `${eh1.grader.judge_model.replace(/^claude-/, "").split("-")[0].replace(/^./, (c) => c.toUpperCase())} · ${eh1.grader.judge_effort}`;
  const takeLabel = { run: "RUN", ab: "A/B", setlist: "SETLIST" }[shownTake];

  return (
    <div className="host rack">
      <Transport
        dh1={dh1}
        take={layout.take}
        onTake={(take) => setLayout((l) => ({ ...l, take }))}
        onPlay={play}
        settings={<SettingsMenu engine={settingsEngine} traces={traces} appearance={appearance} onAppearance={setAppearance} />}
        lights={[
          { label: "DH-1", status: dh1Engine.status, error: dh1Engine.error },
          { label: "EH-1", status: eh1Engine.status, error: eh1Engine.error },
        ]}
      />
      {problems.map((problem) => (
        <p key={problem} className="rack-problem" role="alert">{problem}</p>
      ))}

      <section className={`rack-panel${layout.open === "output" ? " output" : " editor"}`} aria-label={layout.open === "output" ? "Output" : `${TITLES[layout.open][0]} editor`}>
        {layout.open === "output" ? (
          <>
            <header className="panel-head">
              <span className="caps">OUTPUT</span>
              <span className="output-tag">{takeLabel}</span>
              <span className="muted">The latest take. Open a device below to change how it plays.</span>
            </header>
            <div className="panel-body">
              <Dh1Output model={dh1} kind={shownTake} prompt={lastPrompt} onOpenActivity={() => openDh1(undefined, shownTake === "setlist")} />
            </div>
          </>
        ) : (
          <>
            <header className="bar panel-head device">
              <div className="brand">
                <span className="wordmark">RACK / {TITLES[layout.open][0]}</span>
                <span className="tagline">{TITLES[layout.open][1]}</span>
              </div>
              <div className="host-slot" ref={setToolbar} />
              <span className="spacer" />
              <button className="bar-button" onClick={() => open("output")} aria-label="Close: back to the output" title="Back to the output">✕</button>
            </header>
            <div className="panel-body">
              {layout.open === "dh1" && (
                <Dh1Face key={dh1Focus.n} model={dh1} toolbar={toolbar} promptBar={false}
                  initialScreen={dh1Focus.setlist ? "setlist" : "face"} focusSection={dh1Focus.section} />
              )}
              {layout.open === "eh1" && <Eh1Face model={eh1} toolbar={toolbar} chained />}
            </div>
          </>
        )}
      </section>

      <section className="rack-row" aria-label="Rack">
        <Dh1Card model={dh1} collapsed={layout.collapsed.includes("dh1")} onToggleCollapse={collapse("dh1")} onOpen={(section) => openDh1(section)} />
        <Slot />
        <AutoGradeCard on={autoGrade} onToggle={() => setAutoGrade(!autoGrade)} status={follow} ready={eh1Engine.status === "ready"}
          judge={judge} collapsed={layout.collapsed.includes("autograde")} onToggleCollapse={collapse("autograde")} />
        <Slot />
        <Eh1Card model={eh1} status={eh1Engine.status} chained collapsed={layout.collapsed.includes("eh1")}
          onToggleCollapse={collapse("eh1")} onOpen={() => open("eh1")} />
        <Slot />
      </section>
    </div>
  );
}
