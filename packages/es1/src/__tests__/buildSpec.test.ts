import { describe, expect, it } from "vitest";
import {
  DESTINATIONS, INITIAL_BUILD, SOURCES, dataPlaneName, destinationName, draftSpec, nextCommand, pressed, sourceName,
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
    expect(Object.keys(spec.collections)).toEqual(["acme/x/public/orders"]);
    expect(pressed("read", found, PREFIX, "p")).toContain("--collection acme/x/public/orders");
  });

  it("never asks for delete or reset", () => {
    expect(JSON.stringify(draftSpec(build(), PREFIX))).not.toMatch(/"(delete|reset)"/);
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
    expect(DESTINATIONS.filter((d) => !d.sync).map((d) => d.stop)).toEqual(["POSTGRES"]);
    expect(DESTINATIONS.filter((d) => !d.delta).map((d) => d.stop)).toEqual(["ICEBERG"]);
  });
});

describe("commands", () => {
  it("name the profile and data plane", () => {
    expect(dataPlaneName(build({ dataPlane: 0 }))).toBe("ops/dp/public/aws-ap-southeast-2-c1");
    expect(nextCommand(build(), "work")).toBe("flowctl --profile work discover --source flow.yaml --flat --data-plane ops/dp/public/aws-us-east-1-c1");
    expect(nextCommand(build({ found: true }), "work")).toBe("flowctl --profile work draft create");
  });

  it("say what each button would do, using the current settings", () => {
    expect(pressed("publish", build(), PREFIX, "work")).toBe("flowctl --profile work draft publish");
    expect(pressed("read", build(), PREFIX, "p")).toContain("--collection acme/postgres-source/public/orders");
    expect(pressed("read", build({ bindings: [] }), PREFIX, "p")).toContain("<a collection>");
  });

  it("counts a capture, a materialization and each collection that's on", () => {
    expect(specCount(build())).toBe(6);
    expect(specCount(build({ bindings: [] }))).toBe(2);
  });
});
