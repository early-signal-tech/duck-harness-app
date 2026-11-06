import { describe, expect, it } from "vitest";
import { combinedStatus, DEFAULT_LAYOUT, parseLayout, toggleCollapsed } from "../rackLayout";

describe("rack layout", () => {
  it("collapses and expands a device", () => {
    const collapsed = toggleCollapsed(DEFAULT_LAYOUT, "eh1");
    expect(collapsed.collapsed).toEqual(["eh1"]);
    expect(toggleCollapsed(collapsed, "eh1").collapsed).toEqual([]);
  });

  it("cleans a saved layout", () => {
    expect(parseLayout({ collapsed: ["dh1", 3], open: "autograder", take: "ab", rackCollapsed: true }))
      .toEqual({ collapsed: ["dh1"], open: "autograder", take: "ab", rackCollapsed: true });
    expect(parseLayout({ open: "nowhere", take: "jam" })).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
  });

  it("shows the worst engine status", () => {
    expect(combinedStatus(["ready", "ready"])).toBe("ready");
    expect(combinedStatus(["ready", "connecting"])).toBe("connecting");
    expect(combinedStatus(["connecting", "down"])).toBe("down");
  });
});
