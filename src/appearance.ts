// Theme (light / dark / follow the system) and display style (dark hardware LCDs or flat
// light ones). These are app preferences, not run settings, so presets won't carry them.

import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemeChoice = "light" | "dark" | "system";
export type DisplayStyle = "dark" | "light";

export interface Appearance {
  theme: ThemeChoice;
  displays: DisplayStyle;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: "light", displays: "dark" };

const STORAGE_KEY = "dh1.appearance";
const systemDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export function loadAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && typeof saved === "object") return { ...DEFAULT_APPEARANCE, ...saved };
  } catch {
    // Unreadable or blocked storage: use the defaults.
  }
  return DEFAULT_APPEARANCE;
}

export function saveAppearance(appearance: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // Not worth interrupting anyone over.
  }
}

export function resolvedTheme(theme: ThemeChoice): "light" | "dark" {
  return theme === "system" ? (systemDark() ? "dark" : "light") : theme;
}

/** Set the page's theme attributes and the window's title bar to match. */
export function applyAppearance({ theme, displays }: Appearance): void {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme(theme);
  root.dataset.displays = displays;
  try {
    // null = follow the system.
    getCurrentWindow().setTheme(theme === "system" ? null : theme).catch(() => {});
  } catch {
    // Not running inside Tauri (e.g. a plain browser while developing).
  }
}

/** Re-apply when the system appearance changes, while following it. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
