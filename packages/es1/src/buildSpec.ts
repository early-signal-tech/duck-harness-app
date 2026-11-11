// BUILD's model: what each control can be set to, and the draft spec and commands they add
// up to. No rendering here, and nothing here runs: the panel isn't connected to flowctl yet.
//
// Connector tags, required fields and which controls apply come from Estuary's registry
// (`flowctl raw get --table connector_tags`), read 2026-11-08. The stops on INTERVAL, SYNC,
// FLUSH and RETAIN are a useful subset of what the spec allows.

export interface Connector {
  stop: string;
  image: string;
  tag: string;
  required: readonly string[];
}

export interface Source extends Connector {
  /** Runs, exits and is started again, so `interval` applies. Others tail their source. */
  batch: boolean;
}

export interface Destination extends Connector {
  /** Has syncSchedule in its config. */
  sync: boolean;
  /** Has delta_updates on its bindings. */
  delta: boolean;
  /** Has a schema or namespace on its bindings, for source.targetNaming to set. */
  naming: boolean;
}

export const SOURCES: readonly Source[] = [
  { stop: "POSTGRES", image: "source-postgres", tag: "v3", required: ["address", "user", "database", "historyMode", "credentials"], batch: false },
  { stop: "MYSQL", image: "source-mysql", tag: "v3", required: ["address", "user", "credentials", "historyMode"], batch: false },
  { stop: "SQLSERVER", image: "source-sqlserver", tag: "v0", required: ["address", "user", "credentials", "database", "historyMode"], batch: false },
  { stop: "MONGODB", image: "source-mongodb", tag: "v3", required: ["address", "user", "password"], batch: false },
  { stop: "SNOWFLAKE", image: "source-snowflake", tag: "v1", required: ["host", "database", "credentials"], batch: true },
];

export const DESTINATIONS: readonly Destination[] = [
  { stop: "MOTHERDUCK", image: "materialize-motherduck", tag: "v4", required: ["token", "database", "schema", "stagingBucket"], sync: true, delta: true, naming: true },
  { stop: "SNOWFLAKE", image: "materialize-snowflake", tag: "v4", required: ["host", "database", "schema", "timestamp_type", "credentials"], sync: true, delta: true, naming: true },
  { stop: "BIGQUERY", image: "materialize-bigquery", tag: "v3", required: ["project_id", "region", "dataset", "bucket", "credentials"], sync: true, delta: true, naming: true },
  // Files at a path: no sync schedule (uploadInterval is in its CONFIG), no delta and no schema.
  { stop: "S3", image: "materialize-s3-parquet", tag: "v3", required: ["bucket", "region", "credentials", "uploadInterval"], sync: false, delta: false, naming: false },
  { stop: "ICEBERG", image: "materialize-iceberg", tag: "v1", required: ["url", "warehouse", "namespace", "credentials", "compute"], sync: true, delta: false, naming: true },
];

export const DATA_PLANES = [
  "aws-ap-southeast-2-c1", "aws-eu-west-1-c1", "aws-us-east-1-c1", "aws-us-east-1-c2", "aws-us-west-2-c1",
  "azure-centralus-c1", "gcp-us-central1-c1", "gcp-us-central1-c2", "gcp-us-central1-c3",
] as const;

/** A control's stops: what's printed on the panel, and what goes in the spec. */
const stops = <T,>(...pairs: [string, T][]) => pairs.map(([label, value]) => ({ label, value }));

export const LOG_LEVELS = stops(["ERR", "error"], ["WARN", "warn"], ["INFO", "info"], ["DBG", "debug"], ["TRC", "trace"]);
export const INTERVALS = stops(["1m", "1m"], ["5m", "5m"], ["1h", "1h"], ["1d", "24h"]);
export const CODECS = stops(["NONE", "NONE"], ["GZIP", "GZIP"], ["ZSTD", "ZSTANDARD"], ["SNP", "SNAPPY"]);
export const FLUSHES = stops(["15m", "15m"], ["1h", "1h"], ["24h", "24h"]);
export const RETENTIONS = stops<string | null>(["7d", "168h"], ["30d", "720h"], ["1y", "8760h"], ["ALL", null]);
export const SYNCS = stops(["0s", "0s"], ["1m", "1m"], ["5m", "5m"], ["30m", "30m"], ["1h", "1h"], ["4h", "4h"]);
export const ON_CHANGES = stops(["ABORT", "abort"], ["BACKFILL", "backfill"], ["BIND", "disableBinding"], ["TASK", "disableTask"]);
export const NAMINGS = stops(["NONE", "noSchema"], ["WITH", "withSchema"], ["PREFIX", "prefixSchema"], ["NON-DEF", "prefixNonDefaultSchema"]);

export type AutoDiscover = "off" | "add" | "evolve";

export interface Binding {
  table: string;
  on: boolean;
  /** What DISCOVER found. Examples don't have these. */
  target?: string;
  resource?: unknown;
}

/** Until DISCOVER is connected these stand in for what it would find. */
export const EXAMPLE_TABLES: readonly Binding[] = [
  { table: "public/orders", on: true },
  { table: "public/customers", on: true },
  { table: "public/line_items", on: true },
  { table: "public/sales", on: true },
  { table: "public/audit_log", on: false },
  { table: "public/sessions", on: false },
];

export interface BuildState {
  dataPlane: number;
  source: number;
  /** null: named after the prefix and connector, until someone types one. */
  sourceName: string | null;
  autoDiscover: AutoDiscover;
  interval: number;
  logLevel: number;
  captureOn: boolean;
  bindings: Binding[];
  /** The bindings are what DISCOVER found, not examples. */
  found: boolean;
  codec: number;
  flush: number;
  retain: number;
  destination: number;
  destinationName: string | null;
  sync: number;
  onChange: number;
  naming: number;
  delta: boolean;
  fields: boolean;
  materializationOn: boolean;
  armed: boolean;
}

export const INITIAL_BUILD: BuildState = {
  dataPlane: 2,
  source: 0,
  sourceName: null,
  autoDiscover: "add",
  interval: 1,
  logLevel: 2,
  captureOn: true,
  bindings: EXAMPLE_TABLES.map((b) => ({ ...b })),
  found: false,
  codec: 1,
  flush: 1,
  retain: 3,
  destination: 0,
  destinationName: null,
  sync: 3,
  onChange: 0,
  naming: 3,
  delta: false,
  fields: true,
  materializationOn: true,
  armed: false,
};

const CATALOG_NAME = /^(?!.*\.\.)[^\W][\w.-]*(\/[\w.-]+)+$/u;
/** The bridge's check for a catalog name (cli-bridge's table.json). */
export const validName = (name: string) => CATALOG_NAME.test(name);

const shortImage = (image: string) => image.replace(/^(source|materialize)-/, "");

export const sourceName = (state: BuildState, prefix: string) =>
  state.sourceName ?? `${prefix}${shortImage(SOURCES[state.source].image)}-source`;

export const destinationName = (state: BuildState, prefix: string) =>
  state.destinationName ?? `${prefix}${shortImage(DESTINATIONS[state.destination].image)}-destination`;

export const dataPlaneName = (state: BuildState) => `ops/dp/public/${DATA_PLANES[state.dataPlane]}`;

/** Captures, collections and a materialization: what would be published. A found table's
 *  collection is drafted even when its switch is off, because its binding still names it. */
export const specCount = (state: BuildState) => 2 + (state.found ? state.bindings.length : state.bindings.filter((b) => b.on).length);

/** Stands in for what CONFIG and DISCOVER will fill in. */
const FROM_CONFIG = "<from CONFIG>";
const ENCRYPTED = "<encrypted by Estuary>";
const FROM_DISCOVER = "<from DISCOVER>";

/** The draft the controls add up to, as flowctl's spec lays it out. A control that doesn't apply
 *  to this connector stays out of it. Secrets never enter this: CONFIG isn't connected. */
export function draftSpec(state: BuildState, prefix: string) {
  const source = SOURCES[state.source];
  const destination = DESTINATIONS[state.destination];
  const captureName = sourceName(state, prefix);
  const collection = (b: Binding) => b.target ?? `${captureName}/${b.table}`;
  const on = state.found ? state.bindings : state.bindings.filter((b) => b.on);
  const retention = RETENTIONS[state.retain].value;

  return {
    captures: {
      [captureName]: {
        ...(state.autoDiscover === "off" ? {} : {
          autoDiscover: { addNewBindings: true, evolveIncompatibleCollections: state.autoDiscover === "evolve" },
        }),
        ...(source.batch ? { interval: INTERVALS[state.interval].value } : {}),
        shards: { logLevel: LOG_LEVELS[state.logLevel].value, ...(state.captureOn ? {} : { disable: true }) },
        endpoint: { connector: { image: `ghcr.io/estuary/${source.image}:${source.tag}`, config: state.found ? ENCRYPTED : FROM_CONFIG } },
        bindings: state.bindings.map((b) => ({
          resource: b.resource ?? FROM_DISCOVER,
          target: collection(b),
          ...(b.on ? {} : { disable: true }),
        })),
      },
    },
    collections: Object.fromEntries(on.map((b) => [collection(b), {
      key: FROM_DISCOVER,
      schema: FROM_DISCOVER,
      journals: {
        fragments: {
          compressionCodec: CODECS[state.codec].value,
          flushInterval: FLUSHES[state.flush].value,
          ...(retention ? { retention } : {}),
        },
      },
    }])),
    materializations: {
      [destinationName(state, prefix)]: {
        source: {
          capture: captureName,
          ...(destination.naming ? { targetNaming: NAMINGS[state.naming].value } : {}),
          fieldsRecommended: state.fields,
          ...(destination.delta ? { deltaUpdates: state.delta } : {}),
        },
        onIncompatibleSchemaChange: ON_CHANGES[state.onChange].value,
        shards: state.materializationOn ? {} : { disable: true },
        endpoint: {
          connector: {
            image: `ghcr.io/estuary/${destination.image}:${destination.tag}`,
            config: destination.sync
              ? { "<from CONFIG>": "…", syncSchedule: { syncFrequency: SYNCS[state.sync].value } }
              : FROM_CONFIG,
          },
        },
      },
    },
  };
}

type Spec = Record<string, any>;

/** What DRAFT authors: what DISCOVER found, set the way the panel's controls are, and the
 *  destination with its config from CONFIG. It never deletes or resets anything. */
export function draftCatalog(state: BuildState, prefix: string, found: Spec, destinationConfig: Spec, destinationTag: string) {
  const source = SOURCES[state.source];
  const destination = DESTINATIONS[state.destination];
  const captureName = sourceName(state, prefix);
  const capture: Spec = structuredClone(found.captures?.[captureName] ?? {});
  const off = new Set(state.bindings.filter((b) => !b.on).map((b) => b.target));

  delete capture.autoDiscover;
  if (state.autoDiscover !== "off") {
    capture.autoDiscover = { addNewBindings: true, evolveIncompatibleCollections: state.autoDiscover === "evolve" };
  }
  delete capture.interval;
  if (source.batch) capture.interval = INTERVALS[state.interval].value;
  capture.shards = { ...(capture.shards ?? {}), logLevel: LOG_LEVELS[state.logLevel].value };
  if (state.captureOn) delete capture.shards.disable;
  else capture.shards.disable = true;
  capture.bindings = (capture.bindings ?? []).map((binding: Spec) => {
    const { disable: _was, ...rest } = binding;
    return off.has(binding.target) ? { ...rest, disable: true } : rest;
  });

  const retention = RETENTIONS[state.retain].value;
  const collections = Object.fromEntries(Object.entries<Spec>(found.collections ?? {}).map(([name, spec]) => {
    const fragments = { ...(spec.journals?.fragments ?? {}), compressionCodec: CODECS[state.codec].value, flushInterval: FLUSHES[state.flush].value };
    if (retention) fragments.retention = retention;
    else delete fragments.retention;
    return [name, { ...spec, journals: { ...(spec.journals ?? {}), fragments } }];
  }));

  const config: Spec = { ...destinationConfig };
  if (destination.sync) config.syncSchedule = { ...(config.syncSchedule ?? {}), syncFrequency: SYNCS[state.sync].value };
  const materialization: Spec = {
    source: {
      capture: captureName,
      ...(destination.naming ? { targetNaming: NAMINGS[state.naming].value } : {}),
      fieldsRecommended: state.fields,
      ...(destination.delta ? { deltaUpdates: state.delta } : {}),
    },
    onIncompatibleSchemaChange: ON_CHANGES[state.onChange].value,
    endpoint: { connector: { image: `ghcr.io/estuary/${destination.image}${destinationTag}`, config } },
    // Its source capture fills these in, one for each of the capture's collections.
    bindings: [],
    ...(state.materializationOn ? {} : { shards: { disable: true } }),
  };

  return {
    captures: { [captureName]: capture },
    collections,
    materializations: { [destinationName(state, prefix)]: materialization },
  };
}

const flowctl = (profile: string, rest: string) => `flowctl --profile ${profile} ${rest}`;

/** Where the draft stands. "published" is shown until the panel changes again. */
export type DraftStage = "none" | "drafted" | "edited" | "tested" | "failed" | "published";

/** The panel's next step. */
export function nextCommand(state: BuildState, profile: string, stage: DraftStage = "none") {
  if (stage === "tested") return flowctl(profile, `draft publish --init-data-plane ${dataPlaneName(state)}`);
  if (stage === "published") return "Live. Turn MODE to MAP to see it.";
  if (stage === "drafted" || stage === "failed") return flowctl(profile, `draft test --init-data-plane ${dataPlaneName(state)}`);
  if (state.found) return `${flowctl(profile, "draft create")} && flowctl draft author --source draft.json`;
  return flowctl(profile, `discover --source flow.yaml --flat --data-plane ${dataPlaneName(state)}`);
}

/** The buttons that aren't connected yet. */
export type Press = "new" | "read";

/** What a button would do. It's a rehearsal for now: the panel shows this and runs nothing. */
export function pressed(press: Press, state: BuildState, prefix: string, profile: string): string {
  const firstOn = state.bindings.find((b) => b.on);
  switch (press) {
    case "new": return "New collection: key + schema";
    case "read": return flowctl(profile, `collections read --collection ${firstOn ? firstOn.target ?? `${sourceName(state, prefix)}/${firstOn.table}` : "<a collection>"} --since 1h`);
  }
}
