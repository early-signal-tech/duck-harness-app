import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT, loadLayout, saveLayout } from "../layout";

function stubStorage() {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  });
  return items;
}

afterEach(() => vi.unstubAllGlobals());

describe("layout", () => {
  it("remembers the split and text size, but the timeline starts closed every launch", () => {
    const items = stubStorage();
    saveLayout({ answerWidth: 600, textSize: 18, timelineOpen: true });
    expect(items.get("dh1.layout")).not.toContain("timelineOpen");
    expect(loadLayout()).toEqual({ answerWidth: 600, textSize: 18, timelineOpen: false });
  });

  it("ignores an open timeline saved by an older version", () => {
    const items = stubStorage();
    items.set("dh1.layout", JSON.stringify({ answerWidth: 500, textSize: 14, timelineOpen: true }));
    expect(loadLayout().timelineOpen).toBe(false);
  });

  it("uses the defaults when storage is blocked", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });
});
