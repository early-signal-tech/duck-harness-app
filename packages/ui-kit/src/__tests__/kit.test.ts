import { describe, expect, it } from "vitest";
import { clampToStep, valueFromDrag } from "../Knob";
import { splitWidthAt } from "../Splitter";

describe("knob math", () => {
  it("snaps to steps and stays in range", () => {
    expect(clampToStep(2.4, 0, 4, 1)).toBe(2);
    expect(clampToStep(-3, 1, 50, 1)).toBe(1);
    expect(clampToStep(99, 1, 50, 1)).toBe(50);
  });

  it("covers the whole range over one full drag, and less with Shift", () => {
    expect(valueFromDrag(1, 160, 1, 50, 1)).toBe(50);
    expect(valueFromDrag(50, -160, 1, 50, 1)).toBe(1);
    expect(valueFromDrag(25, 40, 1, 50, 1)).toBe(37); // quarter of the range
    expect(valueFromDrag(25, 40, 1, 50, 1, true)).toBe(28); // a sixteenth
  });
});

describe("splitter", () => {
  it("puts the right pane's edge at the pointer, but never too narrow on either side", () => {
    // Panes share 0..1200 with a 12px gutter; minimums 320 (right) and 280 (left).
    expect(splitWidthAt(700, 0, 1200, 12, 320, 280)).toBe(494);
    expect(splitWidthAt(1190, 0, 1200, 12, 320, 280)).toBe(320);
    expect(splitWidthAt(10, 0, 1200, 12, 320, 280)).toBe(1200 - 12 - 280);
  });
});
