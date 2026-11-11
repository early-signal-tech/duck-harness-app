import { describe, expect, it } from "vitest";
import {
  DESTINATIONS, INITIAL_BUILD, SOURCES, dataPlaneName, destinationName, draftCatalog, draftSpec, nextCommand, pressed, sourceName,
  specCount, validName, type BuildState,
} from "../buildSpec";

const build = (patch: Partial<BuildState> = {}): BuildState => ({ ...INITIAL_BUILD, ...patch });
const PREFIX = "acme/";
const only = <T,>(o: Record<string, T>) => Object.values(o)[0];

describe("names", () => {
  it("come from the prefix and connector until someone types one", () => {
    expect(sourceName(build(), PREFIX)).toBe("acme/postgres-source");
    expect(destinationName(build({ destination: 2 }), PREFIX)).toBe("acme/bigquery-destination");
    expect(sourceName(build({ sourceName: "acme/mine" }), PREFIX)).toBe("acme/mine");
  });

  it("check like the bridge does", () => {
    for (const good of ["acme/a", "Early_Signal/jev-datagen/cart_updates", "a.b/c-d_e"]) expect(validName(good)).toBe(true);
    for (const bad of ["acme", "/acme/a", "acme/", "acme//a", "acme/../b", "-x/y", "a b/c", ""]) expect(validName(bad)).toBe(false);
  });
});

describe("draftSpec", () => {
  it("uses the connector each knob points to", () => {
    const spec = draftSpec(build({ source: 3, destination: 4 }), PREFIX);
    expect(only(spec.captures).endpoint.connector.image).toBe("ghcr.io/estuary/source-mongodb:v3");
    expect(only(spec.materializations).endpoint.connector.image).toBe("ghcr.io/estuary/materialize-iceberg:v1");
  });

  it("sets an interval only for a connector that polls", () => {
    expect(only(draftSpec(build({ source: 4, interval: 2 }), PREFIX).captures)).toMatchObject({ interval: "1h" });
    expect(only(draftSpec(build({ source: 0, interval: 2 }), PREFIX).captures)).not.toHaveProperty("interval");
    expect(SOURCES.filter((s) => s.batch).map((s) => s.stop)).toEqual(["SNOWFLAKE"]);
  });

  it("maps auto-discover's three positions", () => {
    expect(only(draftSpec(build({ autoDiscover: "off" }), PREFIX).captures)).not.toHaveProperty("autoDiscover");
    expect(only(draftSpec(build({ autoDiscover: "add" }), PREFIX).captures).autoDiscover).toEqual({ addNewBindings: true, evolveIncompatibleCollections: false });
    expect(only(draftSpec(build({ autoDiscover: "evolve" }), PREFIX).captures).autoDiscover).toEqual({ addNewBindings: true, evolveIncompatibleCollections: true });
  });

  it("disables a binding that's off and leaves out its collection", () => {
    const spec = draftSpec(build(), PREFIX);
    const bindings = only(spec.captures).bindings;
    expect(bindings).toHaveLength(6);
    expect(bindings.filter((b) => "disable" in b).map((b) => b.target)).toEqual(["acme/postgres-source/public/audit_log", "acme/postgres-source/public/sessions"]);
    expect(Object.keys(spec.collections)).toHaveLength(4);
    expect(spec.collections).not.toHaveProperty(["acme/postgres-source/public/sessions"]);
  });

  it("puts the collection knobs under journals.fragments, and leaves retention out at ALL", () => {
    const fragments = (patch: Partial<BuildState>) => only(draftSpec(build(patch), PREFIX).collections).journals.fragments;
    expect(fragments({ codec: 2, flush: 0, retain: 3 })).toEqual({ compressionCodec: "ZSTANDARD", flushInterval: "15m" });
    expect(fragments({ retain: 0 }).retention).toBe("168h");
  });

  it("leaves sync out of a destination without it", () => {
    const config = (destination: number) => only(draftSpec(build({ destination, sync: 4 }), PREFIX).materializations).endpoint.connector.config;
    expect(config(0)).toMatchObject({ syncSchedule: { syncFrequency: "1h" } });
    expect(config(3)).toBe("<from CONFIG>");
  });

  it("leaves naming out of a destination without a schema", () => {
    const source = (destination: number) => only(draftSpec(build({ destination }), PREFIX).materializations).source;
    expect(source(0)).toHaveProperty("targetNaming");
    expect(source(3)).not.toHaveProperty("targetNaming");
  });

  it("leaves delta out of a destination without it", () => {
    const source = (destination: number) => only(draftSpec(build({ destination, delta: true }), PREFIX).materializations).source;
    expect(source(0).deltaUpdates).toBe(true);
    expect(source(4)).not.toHaveProperty("deltaUpdates");
  });

  it("maps the materialization's knobs and points it at the capture", () => {
    const m = only(draftSpec(build({ naming: 1, onChange: 2, fields: false, materializationOn: false }), PREFIX).materializations);
    expect(m.source).toMatchObject({ capture: "acme/postgres-source", targetNaming: "withSchema", fieldsRecommended: false });
    expect(m.onIncompatibleSchemaChange).toBe("disableBinding");
    expect(m.shards).toEqual({ disable: true });
  });

  it("uses what DISCOVER found, and never holds its config", () => {
    const found = build({ found: true, bindings: [
      { table: "public/orders", on: true, target: "acme/x/public/orders", resource: { stream: "orders" } },
      { table: "public/off", on: false, target: "acme/x/public/off", resource: { stream: "off" } },
    ] });
    const spec = draftSpec(found, PREFIX);
    expect(only(spec.captures).bindings[0]).toEqual({ resource: { stream: "orders" }, target: "acme/x/public/orders" });
    expect(only(spec.captures).endpoint.connector.config).toBe("<encrypted by Estuary>");
    expect(Object.keys(spec.collections)).toEqual(["acme/x/public/orders", "acme/x/public/off"]);
    expect(specCount(found)).toBe(4);
    expect(pressed("read", found, PREFIX, "p")).toContain("--collection acme/x/public/orders");
  });

  it("never asks for delete or reset", () => {
    expect(JSON.stringify(draftSpec(build(), PREFIX))).not.toMatch(/"(delete|reset)"/);
  });
});

describe("draftCatalog", () => {
  const NAME = "acme/postgres-source";
  const found = {
    captures: { [NAME]: {
      endpoint: { connector: { image: "ghcr.io/estuary/source-postgres:v3", config: { password_sops: "ENC[x]", sops: { mac: "m" } } } },
      bindings: [
        { resource: { stream: "orders" }, target: `${NAME}/public/orders` },
        { resource: { stream: "logs" }, target: `${NAME}/public/logs`, disable: true },
      ],
    } },
    collections: {
      [`${NAME}/public/orders`]: { key: ["/id"], schema: { type: "object" } },
      [`${NAME}/public/logs`]: { key: ["/id"], schema: { type: "object" }, journals: { fragments: { retention: "1h", length: 5 } } },
    },
  };
  const state = (patch: Partial<BuildState> = {}) => build({
    found: true,
    bindings: [
      { table: "public/orders", target: `${NAME}/public/orders`, on: false },
      { table: "public/logs", target: `${NAME}/public/logs`, on: true },
    ],
    ...patch,
  });
  const catalog = (patch: Partial<BuildState> = {}, config: Record<string, unknown> = { token: "made-up" }) =>
    draftCatalog(state(patch), PREFIX, found, config, ":v4");

  it("keeps the encrypted config and resources DISCOVER found, and sets the switches", () => {
    const capture = only(catalog().captures) as any;
    expect(capture.endpoint).toEqual(found.captures[NAME].endpoint);
    expect(capture.bindings).toEqual([
      { resource: { stream: "orders" }, target: `${NAME}/public/orders`, disable: true },
      { resource: { stream: "logs" }, target: `${NAME}/public/logs` },
    ]);
  });

  it("sets the capture's knobs, and an interval only for a batch connector", () => {
    const capture = only(catalog({ autoDiscover: "off", logLevel: 0, captureOn: false }).captures) as any;
    expect(capture).not.toHaveProperty("autoDiscover");
    expect(capture).not.toHaveProperty("interval");
    expect(capture.shards).toEqual({ logLevel: "error", disable: true });
  });

  it("puts the collection knobs on every found collection, keeping what else they had", () => {
    const collections = catalog({ codec: 2, flush: 2, retain: 3 }).collections as any;
    expect(collections[`${NAME}/public/logs`]).toMatchObject({ key: ["/id"], journals: { fragments: { compressionCodec: "ZSTANDARD", flushInterval: "24h", length: 5 } } });
    expect(collections[`${NAME}/public/logs`].journals.fragments).not.toHaveProperty("retention");
    expect(collections[`${NAME}/public/orders`].journals.fragments).toMatchObject({ compressionCodec: "ZSTANDARD" });
  });

  it("builds the destination from CONFIG and the knobs", () => {
    const m = only(catalog({ sync: 1, naming: 0, onChange: 1, delta: true, fields: false }).materializations) as any;
    expect(m.endpoint.connector).toEqual({ image: "ghcr.io/estuary/materialize-motherduck:v4", config: { token: "made-up", syncSchedule: { syncFrequency: "1m" } } });
    expect(m.source).toEqual({ capture: NAME, targetNaming: "noSchema", fieldsRecommended: false, deltaUpdates: true });
    expect(m.onIncompatibleSchemaChange).toBe("backfill");
    expect(m.bindings).toEqual([]);
    expect(m).not.toHaveProperty("shards");
  });

  it("leaves out what a destination doesn't have", () => {
    const s3 = only(draftCatalog(state({ destination: 3, delta: true }), PREFIX, found, { bucket: "b" }, ":v3").materializations) as any;
    expect(s3.endpoint.connector).toEqual({ image: "ghcr.io/estuary/materialize-s3-parquet:v3", config: { bucket: "b" } });
    expect(s3.source).toEqual({ capture: NAME, fieldsRecommended: true });
    const iceberg = only(draftCatalog(state({ destination: 4, delta: true }), PREFIX, found, { url: "x" }, ":v1").materializations) as any;
    expect(iceberg.source).not.toHaveProperty("deltaUpdates");
  });

  it("doesn't change what DISCOVER found, and never deletes or resets", () => {
    const before = JSON.stringify(found);
    expect(JSON.stringify(catalog())).not.toMatch(/"(delete|reset)"/);
    expect(JSON.stringify(found)).toBe(before);
  });
});

describe("the connector tables match the registry's required fields", () => {
  it("has five of each, each with a tag and fields", () => {
    expect(SOURCES).toHaveLength(5);
    expect(DESTINATIONS).toHaveLength(5);
    for (const c of [...SOURCES, ...DESTINATIONS]) {
      expect(c.tag).toMatch(/^v\d+$/);
      expect(c.required.length).toBeGreaterThan(0);
    }
    expect(DESTINATIONS.map((d) => d.stop)).toEqual(["MOTHERDUCK", "SNOWFLAKE", "BIGQUERY", "S3", "ICEBERG"]);
    expect(DESTINATIONS.filter((d) => !d.sync).map((d) => d.stop)).toEqual(["S3"]);
    expect(DESTINATIONS.filter((d) => !d.delta).map((d) => d.stop)).toEqual(["S3", "ICEBERG"]);
    expect(DESTINATIONS.filter((d) => !d.naming).map((d) => d.stop)).toEqual(["S3"]);
  });
});

describe("commands", () => {
  it("name the profile and data plane", () => {
    expect(dataPlaneName(build({ dataPlane: 0 }))).toBe("ops/dp/public/aws-ap-southeast-2-c1");
    expect(nextCommand(build(), "work")).toBe("flowctl --profile work discover --source flow.yaml --flat --data-plane ops/dp/public/aws-us-east-1-c1");
    expect(nextCommand(build({ found: true }), "work")).toBe("flowctl --profile work draft create && flowctl draft author --source draft.json");
    expect(nextCommand(build({ found: true }), "work", "drafted")).toBe("flowctl --profile work draft test --init-data-plane ops/dp/public/aws-us-east-1-c1");
    expect(nextCommand(build({ found: true }), "work", "tested")).toBe("flowctl --profile work draft publish --init-data-plane ops/dp/public/aws-us-east-1-c1");
  });

  it("say what each button would do, using the current settings", () => {
    expect(pressed("new", build(), PREFIX, "work")).toBe("New collection: key + schema");
    expect(pressed("read", build(), PREFIX, "p")).toContain("--collection acme/postgres-source/public/orders");
    expect(pressed("read", build({ bindings: [] }), PREFIX, "p")).toContain("<a collection>");
  });

  it("counts a capture, a materialization and each collection that's on", () => {
    expect(specCount(build())).toBe(6);
    expect(specCount(build({ bindings: [] }))).toBe(2);
  });
});
