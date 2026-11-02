// The preset picker: ‹ [name ▾] › with a flyout for factory and saved presets, Save,
// Save as, Rename, Delete, Import, and Export. Sits in the host's header bar.

import { Menu, MenuDivider, MenuItem, MenuSection } from "@dh/ui-kit";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useState, type FormEvent } from "react";
import type { Preset } from "../presets";
import type { PresetControls } from "../usePresets";

type Mode = "list" | "save-as" | "rename" | "delete";

export function PresetBar({ presets }: { presets: PresetControls }) {
  const [isOpen, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("list");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { all, current, modified } = presets;
  const own = current && !current.factory;

  const close = useCallback(() => {
    setOpen(false);
    setMode("list");
    setError(null);
  }, []);

  /** Run an action, keeping the menu open with the error if it fails. */
  const attempt = async (action: () => Promise<void> | void, keepOpen = false) => {
    try {
      setError(null);
      await action();
      if (!keepOpen) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startNaming = (next: Mode, initial: string) => {
    setMode(next);
    setName(initial);
    setError(null);
  };

  const submitName = (e: FormEvent) => {
    e.preventDefault();
    attempt(() => (mode === "rename" ? presets.rename(name) : presets.saveAs(name)));
  };

  const doImport = () =>
    attempt(async () => {
      const path = await open({ title: "Import a DH-1 preset", filters: [{ name: "Preset", extensions: ["json"] }] });
      if (typeof path === "string") await presets.importFrom(path);
    });

  const doExport = () =>
    attempt(async () => {
      if (!current) return;
      const path = await save({
        title: "Export preset",
        defaultPath: `${current.name.replace(/[^\w &().-]+/g, "_")}.dh1.json`,
        filters: [{ name: "Preset", extensions: ["json"] }],
      });
      if (path) await presets.exportTo(current, path);
    });

  const item = (preset: Preset) => (
    <MenuItem key={preset.id} checked={preset.id === current?.id} onSelect={() => attempt(() => presets.select(preset))}>
      {preset.name}
    </MenuItem>
  );

  const factory = all.filter((p) => p.factory);
  const mine = all.filter((p) => !p.factory);

  return (
    <div className="bar-group preset-bar">
      <button className="bar-step" aria-label="Previous preset" title="Previous preset" onClick={() => presets.step(-1)}>‹</button>
      <Menu
        open={isOpen}
        onClose={close}
        label="Presets"
        anchor={
          <button
            className="bar-field"
            aria-haspopup="menu"
            aria-expanded={isOpen}
            title={modified ? "Knobs changed since this preset was loaded" : "Presets"}
            onClick={() => (isOpen ? close() : setOpen(true))}
          >
            <span className="name">{current ? current.name : "No preset"}</span>
            <span>
              {modified && <span className="changed">EDITED </span>}
              <span aria-hidden="true">▾</span>
            </span>
          </button>
        }
      >
        {mode === "list" && (
          <>
            <MenuSection title="FACTORY">{factory.map(item)}</MenuSection>
            <MenuSection title="MINE">
              {mine.length ? mine.map(item) : <span className="menu-empty">No saved presets yet</span>}
            </MenuSection>
            <MenuDivider />
            <MenuItem
              disabled={!own || !modified}
              hint={own ? (modified ? undefined : "no changes") : "factory"}
              onSelect={() => attempt(() => presets.save())}
            >
              Save
            </MenuItem>
            <MenuItem onSelect={() => startNaming("save-as", current ? `${current.name.replace(/ \(default\)$/, "")} copy` : "My preset")}>
              Save as…
            </MenuItem>
            <MenuItem disabled={!own} onSelect={() => current && startNaming("rename", current.name)}>Rename…</MenuItem>
            <MenuItem disabled={!own} danger onSelect={() => setMode("delete")}>Delete…</MenuItem>
            <MenuDivider />
            <MenuItem onSelect={doImport}>Import…</MenuItem>
            <MenuItem disabled={!current} onSelect={doExport}>Export…</MenuItem>
          </>
        )}

        {(mode === "save-as" || mode === "rename") && (
          <form className="menu-form" onSubmit={submitName}>
            <span className="menu-title">{mode === "rename" ? "RENAME PRESET" : "SAVE AS A NEW PRESET"}</span>
            <input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.currentTarget.value)} aria-label="Preset name" />
            {mode === "save-as" && <span className="note">Saves the current knobs. Source and prompt aren't part of a preset.</span>}
            <div className="row">
              <button type="button" className="pane-button" onClick={() => startNaming("list", "")}>Back</button>
              <button type="submit" className="pane-button" disabled={!name.trim()}>{mode === "rename" ? "Rename" : "Save"}</button>
            </div>
          </form>
        )}

        {mode === "delete" && current && (
          <div className="menu-form">
            <span className="menu-title">DELETE PRESET</span>
            <span className="note">Delete “{current.name}”? Past runs keep its name in their traces.</span>
            <div className="row">
              <button type="button" className="pane-button" onClick={() => setMode("list")}>Back</button>
              <button type="button" className="pane-button danger" onClick={() => attempt(() => presets.remove())}>Delete</button>
            </div>
          </div>
        )}

        {error && <p className="menu-form error">{error}</p>}
      </Menu>
      <button className="bar-step" aria-label="Next preset" title="Next preset" onClick={() => presets.step(1)}>›</button>
    </div>
  );
}
