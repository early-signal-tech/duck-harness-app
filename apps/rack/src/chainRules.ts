// What can go where in the rack's chain. Each device says what kind it is, what signal it
// takes in, and what it gives out; a chain is valid when each device's input is what the
// devices before it give. Signals flow left to right:
//
//   settings ─▶ instrument ─▶ runs (or grades) ─▶ utilities that take runs ─▶ …
//
// Rules: one instrument per chain (instruments share data only through the traces, never
// through the chain); a device that takes runs comes after an instrument that gives runs;
// a one-per-chain device (AUTO GRADER) appears once. The + slots offer only what fits, and
// a device that no longer fits (its instrument was deleted) says why and stays off.

export type DeviceType = "dh1" | "eh1" | "autograder";
type Signal = "settings" | "runs" | "grades";

export interface DeviceInfo {
  name: string;
  tagline: string;
  kind: "instrument" | "utility";
  takes: Signal;
  gives: Signal;
  onePerChain?: boolean;
  /** One line for the + menu. */
  about: string;
}

export const DEVICES: Record<DeviceType, DeviceInfo> = {
  dh1: { name: "DH-1", tagline: "ANALYTICS AGENT", kind: "instrument", takes: "settings", gives: "runs",
    about: "The analytics agent: runs a prompt, an A/B, or a setlist" },
  eh1: { name: "EH-1", tagline: "EVALUATOR", kind: "instrument", takes: "settings", gives: "grades",
    about: "The evaluator: grade a setlist or a run you pick" },
  autograder: { name: "AUTO GRADER", tagline: "EH-1 INSIDE", kind: "utility", takes: "runs", gives: "runs", onePerChain: true,
    about: "Grades each setlist run as it finishes, with its own EH-1" },
};

export const DEVICE_TYPES = Object.keys(DEVICES) as DeviceType[];

export interface Instance {
  id: string;
  type: DeviceType;
}

export function newInstance(type: DeviceType): Instance {
  return { id: `${type}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, type };
}

/** The signal arriving at position `index` (what the devices before it give out). */
function signalAt(chain: Instance[], index: number): Signal {
  let signal: Signal = "settings";
  for (const instance of chain.slice(0, index)) signal = DEVICES[instance.type].gives;
  return signal;
}

const article = (s: Signal) => (s === "settings" ? "settings" : s);

/** Why `type` can't go at `index` (inserted before what's there now), or null if it can. */
export function cannotInsert(chain: Instance[], index: number, type: DeviceType): string | null {
  const info = DEVICES[type];
  if (info.onePerChain && chain.some((i) => i.type === type)) return `There's already ${info.name === "AUTO GRADER" ? "an" : "a"} ${info.name} in this chain.`;
  if (info.kind === "instrument" && chain.some((i) => DEVICES[i.type].kind === "instrument")) {
    return "One instrument per chain: delete the other first.";
  }
  const arriving = signalAt(chain, index);
  if (arriving !== info.takes) {
    return info.takes === "runs"
      ? `${info.name} needs runs coming in: put it after DH-1.`
      : `${info.name} goes first in the chain.`;
  }
  // What comes after must still get what it takes.
  const after = chain.slice(index);
  if (after.length && DEVICES[after[0].type].takes !== info.gives) {
    return `${DEVICES[after[0].type].name} after it needs ${article(DEVICES[after[0].type].takes)}, and ${info.name} gives ${article(info.gives)}.`;
  }
  return null;
}

/** Every device for the + slot at `index`: the ones that fit, and why the others don't. */
export function choicesAt(chain: Instance[], index: number): { type: DeviceType; problem: string | null }[] {
  return DEVICE_TYPES.map((type) => ({ type, problem: cannotInsert(chain, index, type) }));
}

/** The devices that don't fit where they are, and why (they stay off until they do). */
export function chainProblems(chain: Instance[]): Map<string, string> {
  const problems = new Map<string, string>();
  let instruments = 0;
  chain.forEach((instance, index) => {
    const info = DEVICES[instance.type];
    if (info.kind === "instrument" && ++instruments > 1) problems.set(instance.id, "One instrument per chain.");
    else if (signalAt(chain, index) !== info.takes) {
      problems.set(instance.id, info.takes === "runs" ? `${info.name} needs runs coming in: put DH-1 before it.` : `${info.name} goes first in the chain.`);
    }
  });
  return problems;
}

export const DEFAULT_CHAIN: Instance[] = [{ id: "dh1-default", type: "dh1" }, { id: "autograder-default", type: "autograder" }];

/** A saved chain, cleaned: unknown devices are dropped; nothing usable gives the default. */
export function parseChain(saved: unknown): Instance[] {
  if (!Array.isArray(saved)) return DEFAULT_CHAIN;
  const chain = saved.filter(
    (i): i is Instance => !!i && typeof i === "object" && typeof (i as Instance).id === "string" && DEVICE_TYPES.includes((i as Instance).type),
  );
  return chain.length || saved.length === 0 ? chain : DEFAULT_CHAIN;
}
