// PB-1's settings: what each control can be set to, which controls apply in the current
// mode, and the Parkbench flags they add up to. The face only draws these; the mapping
// lives here so it can be tested without a panel (see the control table in the README).
//
// Only the flags of controls that apply are sent, so a setting that's dimmed on the panel
// can never reach Parkbench (which rejects some combinations, such as VARIANT with the
// simple schema).

export type Mode = "SETUP" | "STREAM" | "BATCH" | "RESET";
export const MODES: readonly Mode[] = ["SETUP", "STREAM", "BATCH", "RESET"];

/** Catalog stops that aren't secrets. Secret names can't contain spaces, so these can't clash. */
export const LOCAL_DUCKDB = "local duckdb";
export const LOCAL_POSTGRES = "local postgres";
export const NEW_SECRET = "+ new secret";

export const TEMPO_BATCH = [1_000, 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const;
/** Seconds between ticks. */
export const TEMPO_STREAM = [5, 2, 1, 0.5, 0.25, 0.1] as const;
/** ± percent around the batch size. */
export const FINE = [0, 10, 25, 50] as const;
/** Batches between flushes; 0 is MAN (never). */
export const FLUSH = [0, 2, 4, 8, 12, 16] as const;
/** Batches (BATCH) or minutes (STREAM); 0 is ∞. */
export const LENGTH = [1, 5, 10, 25, 50, 100, 0] as const;
export const DUPLICATE = [0, 0.02, 0.05, 0.1, 0.15, 0.25, 0.5] as const;
export const DRIFT = [0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5] as const;
export const SCHEMA = ["simple", "rich", "rich_ml"] as const;
export const DISTRIBUTION = ["uniform", "hotspot", "yesterday", "last_week"] as const;
/** Days the hotspot's tail spreads over. */
export const SPAN = [7, 14, 30, 60, 90] as const;
export const USERS = [10, 100, 1_000, 10_000] as const;
export const CONVERSION = [0.05, 0.1, 0.15, 0.25, 0.5] as const;
/** "" is no partitioning. */
export const PARTITION = ["", "day(ts)", "year(ts), month(ts)", "user_id", "bucket(8, user_id)"] as const;
/** How many events (batches or ticks) one step of the sequencer covers. */
export const PRESCALE = [1, 10, 100, 1_000] as const;

/** Parkbench's ticker can't run forever, so ∞ in STREAM asks for a year: in practice, until STOP. */
export const FOREVER_SECONDS = 365 * 24 * 60 * 60;

export interface Pb1Settings {
  mode: Mode;
  /** LOCAL_DUCKDB, LOCAL_POSTGRES, or a DuckLake secret's name. */
  catalog: string;
  batchSize: (typeof TEMPO_BATCH)[number];
  tickInterval: (typeof TEMPO_STREAM)[number];
  fine: (typeof FINE)[number];
  flush: (typeof FLUSH)[number];
  length: (typeof LENGTH)[number];
  duplicateRate: (typeof DUPLICATE)[number];
  driftRate: (typeof DRIFT)[number];
  schema: (typeof SCHEMA)[number];
  payload: "json" | "variant";
  distribution: (typeof DISTRIBUTION)[number];
  span: (typeof SPAN)[number];
  users: (typeof USERS)[number];
  conversion: (typeof CONVERSION)[number];
  mlLabels: boolean;
  partition: (typeof PARTITION)[number];
  sink: "ducklake" | "postgres";
  migrate: boolean;
  prescale: (typeof PRESCALE)[number];
}

export const DEFAULT_SETTINGS: Pb1Settings = {
  mode: "BATCH",
  catalog: LOCAL_DUCKDB,
  batchSize: 100_000,
  tickInterval: 1,
  fine: 0,
  flush: 8,
  length: 10,
  duplicateRate: 0,
  driftRate: 0,
  schema: "simple",
  payload: "json",
  distribution: "uniform",
  span: 30,
  users: 100,
  conversion: 0.15,
  mlLabels: false,
  partition: "",
  sink: "ducklake",
  migrate: false,
  prescale: 1,
};

export const isLocal = (catalog: string) => catalog === LOCAL_DUCKDB || catalog === LOCAL_POSTGRES;

/** The A/B CATALOG VARIATION switch follows the catalog: A for the two local ones, B for a secret. */
export const variation = (catalog: string): "local" | "cloud" => (isLocal(catalog) ? "local" : "cloud");

/** The CATALOG knob's stops: the local catalogs, then each DuckLake secret, then + new secret. */
export const catalogStops = (secrets: readonly string[]): string[] => [LOCAL_DUCKDB, LOCAL_POSTGRES, ...secrets, NEW_SECRET];

export type Control =
  | "tempo" | "fine" | "flush" | "length" | "duplicate" | "drift" | "schema" | "payload"
  | "distribution" | "span" | "users" | "conversion" | "mlLabels" | "partition" | "sink" | "migrate" | "tap";

/** Which controls do something in these settings. The rest are dimmed and send nothing. */
export function active(s: Pb1Settings): Record<Control, boolean> {
  const stream = s.mode === "STREAM";
  const batch = s.mode === "BATCH";
  const running = stream || batch;
  const lake = s.sink === "ducklake";
  const ml = running && s.schema === "rich_ml";
  return {
    tempo: running,
    fine: batch,
    flush: running && lake,
    length: running,
    duplicate: stream,
    drift: stream,
    schema: running,
    payload: running && lake && s.schema !== "simple",
    // The ticker stamps each row with the time it's written.
    distribution: batch,
    span: batch && s.distribution === "hotspot",
    users: ml,
    conversion: ml && s.mlLabels,
    mlLabels: ml,
    partition: batch && lake,
    sink: s.mode !== "RESET",
    migrate: true,
    tap: batch,
  };
}

export type Flags = Record<string, string | number | boolean>;

/** The catalog's connection flags, which setup, reset and run all take. */
export function connectionFlags(s: Pb1Settings): Flags {
  const flags: Flags =
    s.catalog === LOCAL_DUCKDB ? { "metadata-store": "duckdb" }
      : s.catalog === LOCAL_POSTGRES ? { "metadata-store": "postgres" }
        : { "ducklake-secret": s.catalog };
  if (s.sink === "postgres" && s.mode !== "RESET") flags["data-sink"] = "postgres";
  if (s.migrate) flags.migrate = true;
  return flags;
}

/** `parkbench run`'s flags for these settings. `tap` is TAP: a single batch. */
export function runFlags(s: Pb1Settings, { tap = false } = {}): Flags {
  const on = active(s);
  const flags: Flags = { ...connectionFlags(s), "run-mode": s.mode === "STREAM" ? "ticker" : "batch", mode: s.schema };
  if (on.payload && s.payload === "variant") flags["payload-type"] = "variant";
  if (on.users) flags["num-users"] = s.users;
  if (on.mlLabels && s.mlLabels) flags["ml-labels"] = true;
  if (on.conversion) flags["conversion-rate"] = s.conversion;
  if (on.flush) flags["flush-interval"] = s.flush;

  if (s.mode === "STREAM") {
    flags["tick-interval"] = s.tickInterval;
    flags.duration = s.length === 0 ? FOREVER_SECONDS : s.length * 60;
    flags["duplicate-rate"] = s.duplicateRate;
    flags["schema-drift-rate"] = s.driftRate;
    return flags;
  }

  flags["batch-size"] = s.batchSize;
  if (s.fine > 0) {
    flags["batch-size-min"] = Math.round(s.batchSize * (1 - s.fine / 100));
    flags["batch-size-max"] = Math.round(s.batchSize * (1 + s.fine / 100));
  }
  flags["num-batches"] = tap ? 1 : s.length;
  flags.distribution = s.distribution;
  if (on.span) flags["hotspot-days"] = s.span;
  if (on.partition && s.partition) flags["partition-by"] = s.partition;
  return flags;
}

/** What START asks Parkbench to do in each mode. */
export type Command = "setup" | "reset" | "run";

export function commandFor(mode: Mode): Command {
  return mode === "SETUP" ? "setup" : mode === "RESET" ? "reset" : "run";
}

export function flagsFor(s: Pb1Settings, options: { tap?: boolean } = {}): Flags {
  const command = commandFor(s.mode);
  return command === "run" ? runFlags(s, options) : connectionFlags(s);
}

/** The command as you'd type it, for the panel's tooltips. Never holds a secret's values: a
 *  secret is passed by name. */
export function commandLine(command: Command, flags: Flags): string {
  const parts = ["parkbench", command];
  for (const [flag, value] of Object.entries(flags)) {
    if (value === false) continue;
    parts.push(`--${flag}`);
    if (value !== true) parts.push(/[\s,()]/.test(String(value)) ? `"${value}"` : String(value));
  }
  return parts.join(" ");
}

/** The table a run writes to: Parkbench's default name for the schema and sink. */
export function tableName(s: Pb1Settings): string {
  const base = { simple: "events", rich: "events_rich", rich_ml: "events_rich_ml" }[s.schema];
  if (s.sink === "postgres") return `${base}_source`;
  return `wh.${base}${s.payload === "variant" && s.schema !== "simple" ? "_variant" : ""}`;
}
