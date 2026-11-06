// The rack's presets: the factory ones and yours (files in Presets/rack/), which one is
// loaded, whether the rack has moved away from it, and saving, renaming, deleting.
// Loading a preset is the rack's job (`onLoad`): it sets the chain and the devices.

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FACTORY_RACK_PRESETS, newRackPresetId, parseRackPreset, rackEdited, rackPresetToFile, slotsOf, stepRackPreset,
  type RackPreset, type RackState,
} from "./rackPresets";

const CURRENT_KEY = "rack.preset";
const DEVICE = "rack";

export interface RackPresets {
  all: RackPreset[];
  current: RackPreset | null;
  /** The rack has moved away from the loaded preset (its chain, DH-1's preset, or a judge). */
  edited: boolean;
  load: (preset: RackPreset) => void;
  step: (direction: 1 | -1) => void;
  /** Save over the loaded preset (yours only; a factory preset is saved as a new one). */
  save: () => Promise<void>;
  saveAs: (name: string) => Promise<void>;
  rename: (name: string) => Promise<void>;
  remove: () => Promise<void>;
  problem: string | null;
}

export function useRackPresets(state: RackState, onLoad: (preset: RackPreset) => void): RackPresets {
  const [mine, setMine] = useState<RackPreset[]>([]);
  // The first time, the rack's default chain is the factory "DH-1 + AUTO GRADER".
  const [currentId, setCurrentId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(CURRENT_KEY);
      return saved ?? (localStorage.getItem("rack.chain") === null ? FACTORY_RACK_PRESETS[0].id : null);
    } catch {
      return FACTORY_RACK_PRESETS[0].id;
    }
  });
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const texts = await invoke<string[]>("preset_list", { device: DEVICE });
      const parsed: RackPreset[] = [];
      for (const text of texts) {
        try {
          parsed.push(parseRackPreset(text));
        } catch (e) {
          console.warn("Skipping a rack preset file:", e);
        }
      }
      parsed.sort((a, b) => a.name.localeCompare(b.name));
      setMine(parsed);
    } catch {
      // No native side (a browser preview): factory presets only.
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    try {
      if (currentId) localStorage.setItem(CURRENT_KEY, currentId);
      else localStorage.removeItem(CURRENT_KEY);
    } catch {
      // not remembered
    }
  }, [currentId]);

  const all = useMemo(() => [...FACTORY_RACK_PRESETS, ...mine], [mine]);
  const current = all.find((p) => p.id === currentId) ?? null;
  const edited = current ? rackEdited(current, state) : false;

  const load = (preset: RackPreset) => {
    setProblem(null);
    setCurrentId(preset.id);
    onLoad(preset);
  };

  const write = async (preset: RackPreset) => {
    await invoke("preset_write", { device: DEVICE, id: preset.id, contents: rackPresetToFile(preset) });
    await reload();
    setCurrentId(preset.id);
  };

  const attempt = async (work: () => Promise<void>) => {
    setProblem(null);
    try {
      await work();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const saveAs = (name: string) => attempt(async () => {
    const clean = name.trim();
    if (!clean) throw new Error("Give the preset a name.");
    await write({ id: newRackPresetId(), name: clean, revision: 1, savedAt: new Date().toISOString(), devices: slotsOf(state) });
  });

  const save = () => attempt(async () => {
    if (!current || current.factory) throw new Error("A factory preset can't be changed: Save as… makes your own.");
    await write({ ...current, revision: current.revision + 1, savedAt: new Date().toISOString(), devices: slotsOf(state) });
  });

  const rename = (name: string) => attempt(async () => {
    const clean = name.trim();
    if (!current || current.factory) throw new Error("Only your own presets can be renamed.");
    if (!clean) throw new Error("Give the preset a name.");
    await write({ ...current, name: clean, savedAt: new Date().toISOString() });
  });

  const remove = () => attempt(async () => {
    if (!current || current.factory) throw new Error("Factory presets can't be deleted.");
    await invoke("preset_delete", { device: DEVICE, id: current.id });
    await reload();
    setCurrentId(null);
  });

  const step = (direction: 1 | -1) => {
    const next = stepRackPreset(all, currentId, direction);
    if (next) load(next);
  };

  return { all, current, edited, load, step, save, saveAs, rename, remove, problem };
}
