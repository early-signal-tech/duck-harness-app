// The Rack (v3): a transport across the top, one big panel, and a compact rack of devices
// along the bottom, like Bitwig's device chain.
//
// - The TRANSPORT plays the chain: the prompt, RUN / A/B / SETLIST, PLAY and STOP.
// - The PANEL shows the chain's output (the latest take) or, when a device is opened, its
//   full editor; ✕ goes back to the output.
// - The RACK holds the chain: device instances in order, with + slots that offer only
//   what fits there (chainRules.ts). Click a card to select it; Delete removes it.
//   Right-click a card for its menu. Double-click a strip to collapse that card; ▾ RACK
//   or ⌘B collapses the whole rack.
//
// One instrument per chain: DH-1 (with AUTO GRADER after it, which holds its own EH-1) or
// EH-1 on its own. Each device's model lives here (one per kind, since a chain holds at
// most one of each), so a device keeps running whatever the panel shows.

import { Dh1Card, Dh1Face, Dh1Output, useDh1, useEngine as useDh1Engine, type Dh1Section } from "@dh/dh1";
import { Eh1Card, Eh1Face, FOLLOW_IDLE, useEh1, useEngine as useEh1Engine, type FollowStatus, type Grade } from "@dh/eh1";
import { describeSource, questionSetToFile } from "@dh/formats";
import { engineProblems, Menu, MenuDivider, MenuItem, SettingsMenu, tauriTransport, useAppearance, type TracesControls } from "@dh/ui-kit";
import { ask } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AutoGraderCard } from "./AutoGraderCard";
import {
  chainProblems, choicesAt, DEFAULT_CHAIN, DEVICES, newInstance, parseChain, type DeviceType, type Instance,
} from "./chainRules";
import { combinedStatus, loadLayout, saveLayout, toggleCollapsed, type Open } from "./rackLayout";
import { RackPresetBar } from "./RackPresetBar";
import type { RackPreset, RackState } from "./rackPresets";
import { KIND_LABEL, takeFacts, takeNumber } from "./takes";
import { TakeView, type RunGrades } from "./TakeView";
import { Transport } from "./Transport";
import { useRackPresets } from "./useRackPresets";
import { useTakes } from "./useTakes";
import "./rack.css";

// The engines, as the host crate names them.
const dh1Transport = tauriTransport("dh1");
const eh1Transport = tauriTransport("eh1");

// The chain, until rack presets save it as a file (next).
const CHAIN_KEY = "rack.chain";
function loadChain(): Instance[] {
  try {
    const saved = localStorage.getItem(CHAIN_KEY);
    return saved === null ? DEFAULT_CHAIN : parseChain(JSON.parse(saved));
  } catch {
    return DEFAULT_CHAIN;
  }
}
function saveChain(chain: Instance[]): void {
  try {
    localStorage.setItem(CHAIN_KEY, JSON.stringify(chain));
  } catch {
    // not remembered: the default chain next time
  }
}

const TITLES: Record<Exclude<Open, "output">, [string, string]> = {
  dh1: ["DH-1", "ANALYTICS AGENT"],
  eh1: ["EH-1", "EVALUATOR"],
  autograder: ["AUTO GRADER / EH-1", "THE EH-1 INSIDE AUTO GRADER"],
};

/** Where each kind of device opens in the panel. */
const OPENS: Record<DeviceType, Open> = { dh1: "dh1", eh1: "eh1", autograder: "autograder" };

export default function App() {
  const [appearance, setAppearance] = useAppearance();
  const dh1Engine = useDh1Engine(dh1Transport);
  const eh1Engine = useEh1Engine(eh1Transport);

  const [layout, setLayout] = useState(loadLayout);
  useEffect(() => saveLayout(layout), [layout]);
  const open = (target: Open) => setLayout((l) => ({ ...l, open: target }));
  const collapse = (id: string) => () => setLayout((l) => toggleCollapsed(l, id));
  const toggleRack = useCallback(() => setLayout((l) => ({ ...l, rackCollapsed: !l.rackCollapsed })), []);

  // The chain.
  const [chain, setChain] = useState(loadChain);
  useEffect(() => saveChain(chain), [chain]);
  const problems = useMemo(() => chainProblems(chain), [chain]);
  const find = (type: DeviceType) => chain.find((i) => i.type === type);
  const hasDh1 = !!find("dh1") && !problems.has(find("dh1")!.id);
  const autograder = find("autograder");
  const graderWorks = !!autograder && !problems.has(autograder.id);
  const hasEh1 = !!find("eh1") && !problems.has(find("eh1")!.id);

  // AUTO GRADER's power starts off every time the rack opens: grading costs money.
  const [graderOn, setGraderOn] = useState(false);
  const [follow, setFollow] = useState<FollowStatus>(FOLLOW_IDLE);
  const graderChain = useMemo(() => ({ autoGrade: graderOn && graderWorks, onFollow: setFollow }), [graderOn, graderWorks]);

  // The devices' models. AUTO GRADER's EH-1 keeps its own settings, apart from EH-1's.
  // Every DH-1 run records the rack preset it was played from (and whether the rack had
  // been changed since loading it), so the traces can tell which takes belong together.
  const [runLabels, setRunLabels] = useState<Record<string, string | boolean>>({});
  const dh1 = useDh1(dh1Engine, { labels: runLabels });
  const inner = useEh1(eh1Engine, graderChain, { storage: "autograder.eh1", active: graderWorks });
  const eh1 = useEh1(eh1Engine, undefined, { storage: "eh1", active: hasEh1 });

  // Rack presets: the chain, DH-1's preset, and each EH-1's judge settings, as a file.
  const rackState = useMemo<RackState>(() => ({
    chain: chain.map((i) => i.type),
    dh1Preset: dh1.settings.presetId ?? null,
    graders: {
      ...(chain.some((i) => i.type === "autograder") ? { autograder: inner.grader } : {}),
      ...(chain.some((i) => i.type === "eh1") ? { eh1: eh1.grader } : {}),
    },
  }), [chain, dh1.settings.presetId, inner.grader, eh1.grader]);
  const [loadNotice, setLoadNotice] = useState<string | null>(null);
  const loadRackPreset = (preset: RackPreset) => {
    setLoadNotice(null);
    setGraderOn(false);
    setChain(preset.devices.map((d) => newInstance(d.type)));
    setSelected(null);
    setLayout((l) => ({ ...l, collapsed: [], open: "output" }));
    for (const slot of preset.devices) {
      if (slot.type === "dh1" && slot.preset) {
        const found = dh1.presets.all.find((p) => p.id === slot.preset);
        if (found) dh1.presets.select(found);
        else setLoadNotice(`DH-1's preset “${slot.preset}” isn't here any more, so DH-1 kept its settings.`);
      }
      if (slot.type === "autograder" && slot.grader) inner.setGrader({ ...inner.grader, ...slot.grader });
      if (slot.type === "eh1" && slot.grader) eh1.setGrader({ ...eh1.grader, ...slot.grader });
    }
  };
  const rackPresets = useRackPresets(rackState, loadRackPreset);
  const presetId = rackPresets.current?.id ?? null;
  const presetEdited = rackPresets.edited;
  useEffect(() => {
    setRunLabels(presetId ? { rack_preset: presetId, rack_edited: presetEdited } : {});
  }, [presetId, presetEdited]);

  // Takes: what this preset has played, from the traces (◂ ▸ in the panel).
  const playing = dh1.busy || dh1.setlist.busy;
  const takes = useTakes(dh1Engine.harness, presetId, playing);
  // A setlist take's grades from AUTO GRADER's EH-1, when the chain has it.
  const [takeGrades, setTakeGrades] = useState<RunGrades | null>(null);
  const shownTake = takes.shown;
  useEffect(() => {
    setTakeGrades(null);
    if (!shownTake || shownTake.kind !== "setlist" || !graderWorks || !inner.client || !inner.ready) return;
    const set = inner.sets.find((s) => s.id === shownTake.question_set);
    if (!set) return;
    let stale = false;
    const score = (g: Grade) => {
      const correct = g.override?.correct ?? g.correct;
      const careful = g.override?.careful ?? g.careful;
      return correct === null || careful === null || g.efficient === null ? null : correct + careful + g.efficient;
    };
    inner.client.grades(shownTake.key, JSON.parse(questionSetToFile(set)), inner.grader)
      .then((reply) => {
        if (stale || reply.grades.length === 0) return;
        setTakeGrades(new Map(reply.grades.map((g) => [g.run_id, { total: score(g), rulesPassed: g.rules_passed }])));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
    // Grades change as AUTO GRADER works: follow its count too.
  }, [shownTake, graderWorks, inner.client, inner.ready, inner.sets, inner.grader, follow.graded]);

  // What the panel's output shows: the last take PLAY made, and what it asked.
  const [lastTake, setLastTake] = useState(layout.take);
  const [lastPrompt, setLastPrompt] = useState("");
  const liveTake = dh1.setlist.busy ? "setlist" : lastTake;
  // Where DH-1's editor opens: at a section (a tile), or on the Setlist (PLAY with SETLIST).
  const [dh1Focus, setDh1Focus] = useState<{ section: Dh1Section | null; setlist: boolean; n: number }>({ section: null, setlist: false, n: 0 });
  const openDh1 = (section?: Dh1Section, setlist = false) => {
    setDh1Focus((f) => ({ section: section ?? null, setlist, n: f.n + 1 }));
    open("dh1");
  };

  const play = () => {
    if (!hasDh1) return;
    if (layout.take === "setlist") {
      // The setlist DH-1's Setlist has set up (the transport shows it); the take follows it.
      dh1.startSetlist();
      return;
    }
    setLastTake(layout.take);
    setLastPrompt(dh1.settings.prompt);
    takes.follow();
    if (layout.take === "ab") dh1.startBoth();
    else dh1.start();
  };

  // Selecting, adding, and deleting devices.
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ device: string } | { slot: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const insert = (index: number, type: DeviceType) => {
    const instance = newInstance(type);
    setChain((c) => [...c.slice(0, index), instance, ...c.slice(index)]);
    setSelected(instance.id);
    setMenu(null);
  };

  const busyOf = (instance: Instance): boolean => {
    if (instance.type === "dh1") return dh1.anyBusy || dh1.setlist.busy;
    if (instance.type === "eh1") return !!eh1.grading;
    return graderOn && follow.active;
  };

  const remove = useCallback(async (instance: Instance) => {
    setMenu(null);
    const { name } = DEVICES[instance.type];
    if (busyOf(instance)) {
      let ok = false;
      try {
        ok = await ask(`${name} is working. Stop it and delete it from the rack?`, { title: `Delete ${name}`, kind: "warning" });
      } catch {
        ok = window.confirm(`${name} is working. Stop it and delete it from the rack?`);
      }
      if (!ok) return;
      if (instance.type === "dh1") {
        dh1.stop();
        dh1.setlist.stop();
      }
      if (instance.type === "eh1") eh1.stopGrading();
    }
    if (instance.type === "autograder") setGraderOn(false);
    setChain((c) => c.filter((i) => i.id !== instance.id));
    setSelected((s) => (s === instance.id ? null : s));
    setLayout((l) => ({
      ...l,
      open: l.open === OPENS[instance.type] ? "output" : l.open,
      collapsed: l.collapsed.filter((id) => id !== instance.id),
    }));
    // busyOf reads the models, which change every render; this runs on a click or a key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dh1, eh1, graderOn, follow.active]);

  // Keys: ⌘B folds the rack; Delete / Backspace removes the selected device; Esc deselects.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleRack();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (!selected) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        const instance = chain.find((i) => i.id === selected);
        if (instance) {
          e.preventDefault();
          void remove(instance);
        }
      } else if (e.key === "Escape") {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, chain, remove, toggleRack]);

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
  const engineIssues = dh1Hello && eh1Hello
    ? engineProblems([
      { engine: "dh1", version: dh1Hello.version, traces_schema: dh1Hello.traces_schema },
      { engine: "eh1", version: eh1Hello.version, traces_schema: eh1Hello.traces_schema },
    ])
    : [];

  // A device the chain no longer holds can't stay open in the panel.
  const shown: Open = layout.open === "dh1" && !hasDh1 ? "output"
    : layout.open === "eh1" && !hasEh1 ? "output"
    : layout.open === "autograder" && !autograder ? "output"
    : layout.open;

  // The panel's header: a device's name and its own controls (its toolbar slot), or OUTPUT.
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const number = takeNumber(takes.pick, takes.takes.length, playing || takes.live);

  // In SETLIST mode, DH-1's SOURCE tile says what the setlist runs on: its question set's data.
  const draftSet = dh1.setlistDraft.set;
  const setlistSource = draftSet.source ? describeSource(draftSet.source) : "each question's own";

  const cardProps = (instance: Instance) => ({
    selected: selected === instance.id,
    onSelect: () => setSelected(instance.id),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      setSelected(instance.id);
      setMenu({ device: instance.id });
    },
  });

  const card = (instance: Instance) => {
    const collapsed = layout.collapsed.includes(instance.id);
    const props = cardProps(instance);
    switch (instance.type) {
      case "dh1":
        return (
          <Dh1Card model={dh1} collapsed={collapsed} onToggleCollapse={collapse(instance.id)} onOpen={(section) => openDh1(section)}
            setlistSource={layout.take === "setlist" ? setlistSource : undefined} cardProps={props} />
        );
      case "eh1":
        return <Eh1Card model={eh1} status={eh1Engine.status} collapsed={collapsed} onToggleCollapse={collapse(instance.id)} onOpen={() => open("eh1")} cardProps={props} />;
      case "autograder":
        return (
          <AutoGraderCard on={graderOn} onToggle={() => setGraderOn(!graderOn)} status={follow} inner={inner}
            problem={problems.get(instance.id) ?? null} collapsed={collapsed} onToggleCollapse={collapse(instance.id)}
            onOpen={() => open("autograder")} cardProps={props} />
        );
    }
  };

  /** A + slot: what can go here, and why the rest can't. */
  const slot = (index: number) => {
    const isOpen = !!menu && "slot" in menu && menu.slot === index;
    return (
      <Menu key={`slot-${index}`} open={isOpen} onClose={closeMenu} label="Add a device" align="left"
        anchor={
          <button className={`rack-slot${isOpen ? " open" : ""}`} aria-haspopup="menu" aria-label="Add a device here"
            title="Add a device here" onClick={() => setMenu(isOpen ? null : { slot: index })}>+</button>
        }>
        <div className="menu-section">
          <span className="menu-title">ADD HERE</span>
          {choicesAt(chain, index).map(({ type, problem }) => (
            <div key={type} className="slot-choice">
              <MenuItem disabled={!!problem} hint={DEVICES[type].kind} onSelect={() => insert(index, type)}>{DEVICES[type].name}</MenuItem>
              <p className="menu-empty">{problem ?? DEVICES[type].about}</p>
            </div>
          ))}
        </div>
      </Menu>
    );
  };

  return (
    <div className="host rack">
      <Transport
        dh1={dh1}
        presets={<RackPresetBar presets={rackPresets} />}
        playable={hasDh1}
        take={layout.take}
        onTake={(take) => setLayout((l) => ({ ...l, take }))}
        onPlay={play}
        onEditSetlist={() => openDh1(undefined, true)}
        settings={<SettingsMenu engine={settingsEngine} traces={traces} appearance={appearance} onAppearance={setAppearance} />}
        lights={[
          { label: "DH-1", status: dh1Engine.status, error: dh1Engine.error },
          { label: "EH-1", status: eh1Engine.status, error: eh1Engine.error },
        ]}
      />
      {engineIssues.map((problem) => (
        <p key={problem} className="rack-problem" role="alert">{problem}</p>
      ))}
      {loadNotice && <p className="rack-problem notice" role="status">{loadNotice}</p>}

      <section className={`rack-panel${shown === "output" ? " output" : " editor"}`} aria-label={shown === "output" ? "Output" : `${TITLES[shown][0]} editor`}>
        {shown === "output" ? (
          <>
            <header className="panel-head">
              <span className="caps">OUTPUT</span>
              {hasDh1 && (number.of > 0 ? (
                <span className="take-nav">
                  <span className="caps">TAKE {number.n} OF {number.of}</span>
                  <button className="pane-button" aria-label="Earlier take" disabled={number.n <= 1} onClick={() => takes.step(-1)}>‹</button>
                  <button className="pane-button" aria-label="Later take" disabled={number.n >= number.of} onClick={() => takes.step(1)}>›</button>
                </span>
              ) : <span className="muted">No takes yet: PLAY makes one.</span>)}
              {hasDh1 && takes.live && <span className="output-tag">{KIND_LABEL[liveTake]}</span>}
              {hasDh1 && takes.live && playing && <span className="take-playing">● PLAYING</span>}
              {hasDh1 && takes.shown && <span className="output-tag">{KIND_LABEL[takes.shown.kind]}</span>}
              {hasDh1 && takes.shown && <span className="muted mono">{takeFacts(takes.shown)}</span>}
              {!hasDh1 && <span className="muted">What the chain's instrument produces shows here.</span>}
              {takes.problem && <span className="error">{takes.problem}</span>}
            </header>
            <div className="panel-body">
              {hasDh1 ? (
                takes.live || !takes.shown
                  ? <Dh1Output model={dh1} kind={liveTake} prompt={lastPrompt} onOpenActivity={() => openDh1(undefined, liveTake === "setlist")} />
                  : <TakeView take={takes.shown} runs={takes.runs} grades={takeGrades} />
              ) : hasEh1 ? (
                <div className="output-empty">
                  <p>This chain is EH-1 on its own: open it to pick a setlist and grade it.</p>
                  <button className="pane-button" onClick={() => open("eh1")}>Open EH-1 ⤢</button>
                </div>
              ) : (
                <div className="output-empty"><p>The chain is empty: add an instrument with + below.</p></div>
              )}
            </div>
          </>
        ) : (
          <>
            <header className="bar panel-head device">
              <div className="brand">
                <span className="wordmark">RACK / {TITLES[shown][0]}</span>
                <span className="tagline">{TITLES[shown][1]}</span>
              </div>
              <div className="host-slot" ref={setToolbar} />
              <span className="spacer" />
              <button className="bar-button" onClick={() => open("output")} aria-label="Close: back to the output" title="Back to the output">✕</button>
            </header>
            <div className="panel-body">
              {shown === "dh1" && (
                <Dh1Face key={dh1Focus.n} model={dh1} toolbar={toolbar} promptBar={false}
                  initialScreen={dh1Focus.setlist ? "setlist" : "face"} focusSection={dh1Focus.section} />
              )}
              {shown === "eh1" && <Eh1Face model={eh1} toolbar={toolbar} />}
              {shown === "autograder" && <Eh1Face model={inner} toolbar={toolbar} chained />}
            </div>
          </>
        )}
      </section>

      <section className={`rack-dock${layout.rackCollapsed ? " folded" : ""}`} aria-label="Rack">
        <div className="rack-bar">
          <button className="rack-handle" onClick={toggleRack} aria-expanded={!layout.rackCollapsed}
            aria-label={layout.rackCollapsed ? "Show the rack" : "Fold the rack"}
            title={layout.rackCollapsed ? "Show the rack (⌘B)" : "Fold the rack (⌘B)"}>
            <svg className={`rack-handle-chevron${layout.rackCollapsed ? " up" : ""}`} width="14" height="14" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 9l7 7 7-7" />
            </svg>
            <span className="rack-handle-key">⌘B</span>
          </button>
          {layout.rackCollapsed && (
            <div className="rack-chips">
              {chain.map((instance) => (
                <button key={instance.id} className="rack-chip" onClick={() => open(OPENS[instance.type])}
                  title={`Open ${DEVICES[instance.type].name} in the panel`}>
                  {busyOf(instance) && <span className="strip-live" aria-label="working" />}
                  {DEVICES[instance.type].name}
                </button>
              ))}
              {chain.length === 0 && <span className="muted">Empty</span>}
            </div>
          )}
          {!layout.rackCollapsed && selected && (
            <span className="muted rack-hint">Delete removes the selected device · right-click for more</span>
          )}
        </div>
        {!layout.rackCollapsed && (
          <div className="rack-row" onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}>
            {slot(0)}
            {chain.map((instance, index) => (
              <div key={instance.id} className={`rack-item${problems.has(instance.id) ? " misplaced" : ""}`}>
                <Menu open={!!menu && "device" in menu && menu.device === instance.id} onClose={closeMenu}
                  label={`${DEVICES[instance.type].name} menu`} align="left" anchor={card(instance)}>
                  <MenuItem onSelect={() => { setMenu(null); open(OPENS[instance.type]); }}>Open in the panel</MenuItem>
                  <MenuItem onSelect={() => { setMenu(null); collapse(instance.id)(); }}>
                    {layout.collapsed.includes(instance.id) ? "Expand" : "Collapse"}
                  </MenuItem>
                  <MenuDivider />
                  <MenuItem danger hint="⌫" onSelect={() => void remove(instance)}>Delete {DEVICES[instance.type].name}</MenuItem>
                </Menu>
                {slot(index + 1)}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
