import { describe, expect, it } from "vitest";
import { combinedStatus, DEFAULT_LAYOUT, setFolded, setFull } from "../rackLayout";

describe("rack layout", () => {
  it("folds and unfolds a device", () => {
    const folded = setFolded(DEFAULT_LAYOUT, "dh1", true);
    expect(folded.folded).toEqual(["dh1"]);
    expect(setFolded(folded, "dh1", false).folded).toEqual([]);
  });

  it("unfolds a device given the whole window", () => {
    const layout = setFull({ folded: ["eh1"], full: null }, "eh1", true);
    expect(layout).toEqual({ folded: [], full: "eh1" });
    expect(setFull(layout, "eh1", false).full).toBeNull();
  });

  it("goes back to the rack when the full device is folded", () => {
    expect(setFolded({ folded: [], full: "dh1" }, "dh1", true)).toEqual({ folded: ["dh1"], full: null });
  });

  it("shows the worst engine status", () => {
    expect(combinedStatus(["ready", "ready"])).toBe("ready");
    expect(combinedStatus(["ready", "connecting"])).toBe("connecting");
    expect(combinedStatus(["connecting", "down"])).toBe("down");
  });
});
