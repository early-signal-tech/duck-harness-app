// Keyboard shortcuts in a host with several devices. A device listens on the window (so
// its shortcuts work wherever focus is), but in the rack a key pressed inside another
// device belongs to that device: Esc in EH-1 mustn't stop a DH-1 run. Devices (and the
// rack's frames) mark their element with data-device="<name>".

/** True when the key was pressed inside a different device than `device`. */
export function keyForOtherDevice(event: KeyboardEvent, device: string): boolean {
  const target = event.target as { closest?: (selector: string) => Element | null } | null;
  const owner = typeof target?.closest === "function" ? target.closest("[data-device]") : null;
  return owner != null && owner.getAttribute("data-device") !== device;
}
