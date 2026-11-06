import { describe, expect, it } from "vitest";
import { keyForOtherDevice } from "../deviceKeys";

/** A stand-in element inside a device (or none): closest() finds that device's element. */
function inDevice(device: string | null) {
  const owner = device === null ? null : { getAttribute: (name: string) => (name === "data-device" ? device : null) };
  return { closest: (selector: string) => (selector === "[data-device]" ? owner : null) };
}
const keyIn = (target: unknown) => ({ target }) as unknown as KeyboardEvent;

describe("keyForOtherDevice", () => {
  it("leaves a device its own keys", () => {
    expect(keyForOtherDevice(keyIn(inDevice("dh1")), "dh1")).toBe(false);
  });

  it("skips keys pressed inside another device", () => {
    expect(keyForOtherDevice(keyIn(inDevice("eh1")), "dh1")).toBe(true);
  });

  it("keeps keys pressed outside every device (the standalone apps, the window)", () => {
    expect(keyForOtherDevice(keyIn(inDevice(null)), "dh1")).toBe(false);
    expect(keyForOtherDevice(keyIn({}), "eh1")).toBe(false);
    expect(keyForOtherDevice(keyIn(null), "eh1")).toBe(false);
  });
});
