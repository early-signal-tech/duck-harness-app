// Layout preferences for the bottom panes: the Activity / Answer split and their text
// size. Remembered between launches, like the theme; presets don't carry them.

export const TEXT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20] as const;
export const DEFAULT_TEXT_SIZE = 14;

export const DEFAULT_ANSWER_WIDTH = 520;
export const MIN_ANSWER_WIDTH = 320;
export const MIN_ACTIVITY_WIDTH = 280;

export interface Layout {
  answerWidth: number;
  textSize: number;
}

export const DEFAULT_LAYOUT: Layout = { answerWidth: DEFAULT_ANSWER_WIDTH, textSize: DEFAULT_TEXT_SIZE };

const STORAGE_KEY = "dh1.layout";

export function loadLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && typeof saved === "object") return { ...DEFAULT_LAYOUT, ...saved };
  } catch {
    // Unreadable or blocked storage: use the defaults.
  }
  return DEFAULT_LAYOUT;
}

export function saveLayout(layout: Layout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Not worth interrupting anyone over.
  }
}

/** The next text size up (+1) or down (-1), staying on the list. */
export function stepTextSize(size: number, direction: 1 | -1): number {
  const sizes: readonly number[] = TEXT_SIZES;
  if (direction > 0) return sizes.find((s) => s > size) ?? sizes[sizes.length - 1];
  return [...sizes].reverse().find((s) => s < size) ?? sizes[0];
}

/** Answer width for a splitter at `pointerX`, kept so neither pane gets too narrow.
 *  `left` and `right` are the edges of the area the two panes share. */
export function answerWidthAt(pointerX: number, left: number, right: number, gutter: number): number {
  const max = right - left - gutter - MIN_ACTIVITY_WIDTH;
  const width = right - pointerX - gutter / 2;
  return Math.round(Math.max(MIN_ANSWER_WIDTH, Math.min(max, width)));
}
