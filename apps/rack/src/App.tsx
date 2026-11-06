// The Rack: one host with both engines, and DH-1 and EH-1 side by side as devices in a
// horizontal chain, like an Ableton device chain. Each device sits in a frame that can
// fold to a strip or fill the window. The devices are the same ones the standalone apps
// show; chaining them (DH-1's output into EH-1) comes next.

import { Dh1, useEngine as useDh1Engine } from "@dh/dh1";
import { Eh1, useEngine as useEh1Engine } from "@dh/eh1";
import {
  engineProblems, HostBar, SettingsMenu, tauriTransport, useAppearance, type TracesControls,
} from "@dh/ui-kit";
import { useEffect, useMemo, useState } from "react";
import { DeviceFrame } from "./DeviceFrame";
import { combinedStatus, loadLayout, saveLayout, setFolded, setFull } from "./rackLayout";
import "./rack.css";

// The engines, as the host crate names them.
const dh1Transport = tauriTransport("dh1");
const eh1Transport = tauriTransport("eh1");

export default function App() {
  const [appearance, setAppearance] = useAppearance();
  const dh1 = useDh1Engine(dh1Transport);
  const eh1 = useEh1Engine(eh1Transport);

  const [layout, setLayout] = useState(loadLayout);
  useEffect(() => saveLayout(layout), [layout]);

  // DH-1's agent runs the traces server, so Settings manages it through DH-1's engine.
  const harness = dh1.harness;
  const traces = useMemo<TracesControls | undefined>(() => harness
    ? { info: () => harness.traces(), stop: () => harness.tracesStop(), reset: () => harness.tracesReset() }
    : undefined, [harness]);

  // Settings are the host's: the key and the traces file apply to both engines, so a
  // change restarts both.
  const { status: dh1Status, restart: restartDh1, hello: dh1Hello } = dh1;
  const { status: eh1Status, restart: restartEh1, hello: eh1Hello } = eh1;
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

  const frame = (device: string) => ({
    device,
    folded: layout.folded.includes(device),
    full: layout.full === device,
    hidden: layout.full !== null && layout.full !== device,
    onFold: (folded: boolean) => setLayout((l) => setFolded(l, device, folded)),
    onFull: (full: boolean) => setLayout((l) => setFull(l, device, full)),
  });

  return (
    <div className="host rack">
      <HostBar
        name="RACK"
        tagline="DUCK HARNESS"
        engines={[
          { label: "DH-1", status: dh1.status, error: dh1.error },
          { label: "EH-1", status: eh1.status, error: eh1.error },
        ]}
        settings={<SettingsMenu engine={settingsEngine} traces={traces} appearance={appearance} onAppearance={setAppearance} />}
      />
      {problems.map((problem) => (
        <p key={problem} className="rack-problem" role="alert">{problem}</p>
      ))}
      <div className={`rack-chain${layout.full ? " has-full" : ""}`}>
        <DeviceFrame {...frame("dh1")} name="DH-1" tagline="ANALYTICS AGENT" status={dh1.status}>
          {(toolbar) => <Dh1 engine={dh1} toolbar={toolbar} />}
        </DeviceFrame>
        <DeviceFrame {...frame("eh1")} name="EH-1" tagline="EVALUATOR" status={eh1.status}>
          {(toolbar) => <Eh1 engine={eh1} toolbar={toolbar} />}
        </DeviceFrame>
      </div>
    </div>
  );
}
