// The rack's preset bar, in the transport: ‹ name ● ▾ ›. The menu lists the factory
// presets and yours; Save, Save as…, Rename…, and Delete work on the loaded one. ● says the
// rack has moved away from the preset (another chain, DH-1 preset, or judge).

import { Menu, MenuDivider, MenuItem, MenuSection } from "@dh/ui-kit";
import { useState } from "react";
import type { RackPresets } from "./useRackPresets";

type Form = { kind: "saveAs" | "rename"; name: string } | null;

export function RackPresetBar({ presets }: { presets: RackPresets }) {
  const { all, current, edited } = presets;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(null);
  const close = () => {
    setOpen(false);
    setForm(null);
  };
  const factory = all.filter((p) => p.factory);
  const mine = all.filter((p) => !p.factory);
  const submit = async () => {
    if (!form) return;
    await (form.kind === "saveAs" ? presets.saveAs(form.name) : presets.rename(form.name));
    close();
  };
  return (
    <div className="bar-group rack-preset-bar">
      <button className="bar-step" aria-label="Previous rack preset" onClick={() => presets.step(-1)}>‹</button>
      <Menu open={open} onClose={close} label="Rack presets" align="left"
        anchor={
          <button className="bar-field rack-preset-field" aria-haspopup="menu" onClick={() => setOpen(!open)}
            title={current ? `Rack preset: ${current.name}${edited ? " (edited)" : ""}` : "No rack preset loaded"}>
            <span className="name">{current?.name ?? "No preset"}</span>
            {edited && <span className="rack-preset-edited" aria-label="edited">●</span>}
            <span aria-hidden="true">▾</span>
          </button>
        }>
        <MenuSection title="FACTORY">
          {factory.map((p) => (
            <MenuItem key={p.id} checked={p.id === current?.id} onSelect={() => { presets.load(p); close(); }}>{p.name}</MenuItem>
          ))}
        </MenuSection>
        <MenuSection title="MINE">
          {mine.length === 0 && <p className="menu-empty">None yet: Save as… keeps this rack as a preset.</p>}
          {mine.map((p) => (
            <MenuItem key={p.id} checked={p.id === current?.id} onSelect={() => { presets.load(p); close(); }}>{p.name}</MenuItem>
          ))}
        </MenuSection>
        <MenuDivider />
        {form ? (
          <form className="menu-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <label className="menu-title" htmlFor="rack-preset-name">{form.kind === "saveAs" ? "SAVE AS" : "RENAME"}</label>
            <div className="row">
              <input id="rack-preset-name" autoFocus value={form.name} placeholder="Preset name"
                onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
              <button className="pane-button" type="submit" disabled={!form.name.trim()}>Save</button>
            </div>
            <span className="note">Saves the chain, DH-1's preset, and each EH-1's judge settings.</span>
          </form>
        ) : (
          <>
            <MenuItem disabled={!current || current.factory || !edited} onSelect={() => { void presets.save(); close(); }}
              hint={current?.factory ? "factory" : undefined}>Save</MenuItem>
            <MenuItem onSelect={() => setForm({ kind: "saveAs", name: current && !current.factory ? `${current.name} copy` : "" })}>Save as…</MenuItem>
            <MenuItem disabled={!current || current.factory} onSelect={() => setForm({ kind: "rename", name: current?.name ?? "" })}>Rename…</MenuItem>
            <MenuItem danger disabled={!current || current.factory} onSelect={() => { void presets.remove(); close(); }}>Delete</MenuItem>
          </>
        )}
        {presets.problem && <p className="menu-empty error">{presets.problem}</p>}
      </Menu>
      <button className="bar-step" aria-label="Next rack preset" onClick={() => presets.step(1)}>›</button>
    </div>
  );
}
