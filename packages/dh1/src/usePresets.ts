// Preset state for the DH-1 device: the factory and saved presets, which one the knobs
// came from, whether they've changed since, and the actions on them.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyPreset, byName, deleteUserPreset, exportPreset, FACTORY_PRESETS, importPreset, loadUserPresets,
  matchesPreset, newPresetId, settingsOf, presetSourceOf, stepPreset, writeUserPreset, type Preset,
} from "./presets";
import type { FaceSettings } from "./settings";

export interface PresetControls {
  all: Preset[];
  current: Preset | undefined;
  modified: boolean;
  select: (preset: Preset) => void;
  step: (direction: 1 | -1) => void;
  save: () => Promise<void>;
  saveAs: (name: string, includeSource: boolean) => Promise<void>;
  rename: (name: string) => Promise<void>;
  remove: () => Promise<void>;
  importFrom: (path: string) => Promise<void>;
  exportTo: (preset: Preset, path: string) => Promise<void>;
}

export function usePresets(
  settings: FaceSettings,
  setSettings: (update: (s: FaceSettings) => FaceSettings) => void,
): PresetControls {
  const [mine, setMine] = useState<Preset[]>([]);

  useEffect(() => {
    loadUserPresets()
      .then(setMine)
      .catch((e) => console.warn("Couldn't load presets:", e));
  }, []);

  const all = useMemo(() => [...FACTORY_PRESETS, ...mine], [mine]);
  const current = all.find((p) => p.id === settings.presetId);
  const modified = current ? !matchesPreset(settings, current) : false;

  const select = useCallback((preset: Preset) => setSettings((s) => applyPreset(s, preset)), [setSettings]);

  const step = useCallback(
    (direction: 1 | -1) => {
      const next = stepPreset(all, settings.presetId, direction);
      if (next) select(next);
    },
    [all, settings.presetId, select],
  );

  const checkName = (name: string, except?: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Give the preset a name.");
    if (all.some((p) => p.id !== except && p.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`There's already a preset called “${trimmed}”.`);
    }
    return trimmed;
  };

  const store = async (preset: Preset) => {
    await writeUserPreset(preset);
    setMine((list) => [...list.filter((p) => p.id !== preset.id), preset].sort(byName));
  };

  const save = async () => {
    if (!current || current.factory) throw new Error("Factory presets can't be changed. Use Save as.");
    await store({
      ...current,
      settings: settingsOf(settings),
      // A preset that holds a source keeps holding one, now the current one.
      ...(current.source ? { source: presetSourceOf(settings) } : {}),
      revision: current.revision + 1,
      savedAt: new Date().toISOString(),
    });
  };

  const saveAs = async (name: string, includeSource: boolean) => {
    const preset: Preset = {
      id: newPresetId(),
      name: checkName(name),
      revision: 1,
      savedAt: new Date().toISOString(),
      settings: settingsOf(settings),
      ...(includeSource ? { source: presetSourceOf(settings) } : {}),
    };
    await store(preset);
    setSettings((s) => ({ ...s, presetId: preset.id }));
  };

  const rename = async (name: string) => {
    if (!current || current.factory) throw new Error("Factory presets can't be renamed.");
    await store({ ...current, name: checkName(name, current.id), savedAt: new Date().toISOString() });
  };

  const remove = async () => {
    if (!current || current.factory) throw new Error("Factory presets can't be deleted.");
    await deleteUserPreset(current.id);
    setMine((list) => list.filter((p) => p.id !== current.id));
    setSettings((s) => ({ ...s, presetId: null })); // the knobs stay as they are
  };

  const importFrom = async (path: string) => {
    let preset = await importPreset(path);
    // Never overwrite a preset by importing: a clashing id or name gets a new one.
    if (all.some((p) => p.id === preset.id)) preset = { ...preset, id: newPresetId() };
    if (all.some((p) => p.name.toLowerCase() === preset.name.toLowerCase())) {
      let n = 2;
      while (all.some((p) => p.name.toLowerCase() === `${preset.name} ${n}`.toLowerCase())) n++;
      preset = { ...preset, name: `${preset.name} ${n}` };
    }
    await store(preset);
    select(preset);
  };

  const exportTo = (preset: Preset, path: string) => exportPreset(preset, path);

  return { all, current, modified, select, step, save, saveAs, rename, remove, importFrom, exportTo };
}
