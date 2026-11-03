// The DH kit: shared controls and the shared look for every Duck Harness plugin.
export { applyAppearance, loadAppearance, saveAppearance, resolvedTheme, DEFAULT_APPEARANCE } from "./appearance";
export type { Appearance, DisplayStyle, ThemeChoice } from "./appearance";
export { useAppearance } from "./useAppearance";
export { AppearanceControls, HostBar } from "./HostBar";
export type { EngineStatus } from "./HostBar";
export { Knob, SteppedKnob, clampToStep, valueFromDrag } from "./Knob";
export { Toggle } from "./Toggle";
export type { KnobProps } from "./Knob";
export { Markdown, slugify } from "./Markdown";
export { Splitter, splitWidthAt, SPLITTER_GUTTER } from "./Splitter";
export { Menu, MenuDivider, MenuItem, MenuSection, useDismiss } from "./Menu";
export { SettingsMenu } from "./Settings";
export type { SettingsEngine, TracesControls, TracesInfo } from "./Settings";
