// Checking that a host's engines belong together. Each device's client already refuses
// an engine that speaks another protocol (Harness.hello, Engine.hello). What only the
// host can see is two engines disagreeing with each other: DH-1's agent writes the traces
// and EH-1's grader reads them, so both must have been built for the same traces schema.

export interface EngineVersion {
  /** The engine's name: "dh1" or "eh1". */
  engine: string;
  /** From hello: the engine package's version. */
  version?: string;
  /** From hello: the agent traces schema the engine writes or reads. */
  traces_schema?: string;
}

const NAMES: Record<string, string> = { dh1: "DH-1's agent", eh1: "EH-1's grader" };
const named = (e: EngineVersion) => `${NAMES[e.engine] ?? e.engine}${e.version ? ` (${e.version})` : ""}`;

/** Why these engines can't share a traces file, one sentence each; empty when they can. */
export function engineProblems(engines: EngineVersion[]): string[] {
  if (engines.length < 2) return [];
  const unknown = engines.filter((e) => !e.traces_schema);
  if (unknown.length) {
    return unknown.map((e) => `${named(e)} doesn't report its traces schema: update it.`);
  }
  const schemas = new Set(engines.map((e) => e.traces_schema));
  if (schemas.size === 1) return [];
  const which = engines.map((e) => `${named(e)} uses traces schema ${e.traces_schema}`).join(", ");
  return [`The engines don't agree on the traces: ${which}. Update them to versions released together.`];
}
