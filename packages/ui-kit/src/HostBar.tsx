// The charcoal bar across the top of a host window: the product name, the device's own
// controls, the host's settings (a gear), and an engine light (the rack has one per
// engine). Each standalone app has one; the rack has one too. Appearance (theme, displays) lives in the settings flyout:
// AppearanceControls below.

import type { ReactNode } from "react";
import type { Appearance, DisplayStyle, ThemeChoice } from "./appearance";

export type EngineStatus = "connecting" | "ready" | "down";

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "LIGHT" },
  { value: "dark", label: "DARK" },
  { value: "system", label: "AUTO" },
];

const DISPLAYS: { value: DisplayStyle; label: string }[] = [
  { value: "dark", label: "DARK" },
  { value: "light", label: "LIGHT" },
];

function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** THEME (light, dark, follow the system) and DISPLAYS (charcoal LCDs or outlined white). */
export function AppearanceControls({ appearance, onChange }: { appearance: Appearance; onChange: (appearance: Appearance) => void }) {
  return (
    <div className="appearance-controls">
      <span className="settings-label">THEME</span>
      <Segmented label="Theme" options={THEMES} value={appearance.theme} onChange={(theme) => onChange({ ...appearance, theme })} />
      <span className="settings-label">DISPLAYS</span>
      <Segmented label="Displays" options={DISPLAYS} value={appearance.displays} onChange={(displays) => onChange({ ...appearance, displays })} />
    </div>
  );
}

interface Props {
  name: string;
  tagline: string;
  engine?: { status: EngineStatus; error?: string | null };
  /** Several lights, labelled (the rack: DH-1, EH-1). Used instead of `engine`. */
  engines?: { label: string; status: EngineStatus; error?: string | null }[];
  /** Device controls shown next to the name, such as DH-1's preset bar. */
  children?: ReactNode;
  /** The host's settings control (a gear and its flyout), before the engine light. */
  settings?: ReactNode;
}

export function HostBar({ name, tagline, engine, engines, children, settings }: Props) {
  return (
    <header className="bar">
      <div className="brand">
        <span className="wordmark">{name}</span>
        <span className="tagline">{tagline}</span>
      </div>
      {children}
      <div className="spacer" />
      {settings}
      {engine && !engines && (
        <div className={`engine ${engine.status}`} title={engine.error ?? undefined}>
          <span className="dot" aria-hidden="true" />
          {engine.status === "ready" ? "ENGINE" : engine.status === "connecting" ? "STARTING" : "OFFLINE"}
        </div>
      )}
      {engines?.map((e) => (
        <div key={e.label} className={`engine ${e.status}`}
          title={e.error ?? `${e.label} engine: ${e.status === "ready" ? "running" : e.status === "connecting" ? "starting" : "offline"}`}>
          <span className="dot" aria-hidden="true" />
          {e.label}
        </div>
      ))}
    </header>
  );
}
