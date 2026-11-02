// The charcoal bar across the top of a host window: the product name, the appearance
// switches, and an engine light. Each standalone app has one; the rack will too.

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

export function BarSwitch<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="bar-switch">
      <span>{label}</span>
      <div role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface Props {
  name: string;
  tagline: string;
  appearance: Appearance;
  onAppearance: (appearance: Appearance) => void;
  engine?: { status: EngineStatus; error?: string | null };
  children?: ReactNode;
}

export function HostBar({ name, tagline, appearance, onAppearance, engine, children }: Props) {
  return (
    <header className="bar">
      <div className="brand">
        <span className="wordmark">{name}</span>
        <span className="tagline">{tagline}</span>
      </div>
      <div className="spacer" />
      {children}
      <BarSwitch label="THEME" options={THEMES} value={appearance.theme} onChange={(theme) => onAppearance({ ...appearance, theme })} />
      <BarSwitch label="DISPLAYS" options={DISPLAYS} value={appearance.displays} onChange={(displays) => onAppearance({ ...appearance, displays })} />
      {engine && (
        <div className={`engine ${engine.status}`} title={engine.error ?? undefined}>
          <span className="dot" aria-hidden="true" />
          {engine.status === "ready" ? "ENGINE" : engine.status === "connecting" ? "STARTING" : "OFFLINE"}
        </div>
      )}
    </header>
  );
}
