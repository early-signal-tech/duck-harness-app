import { describe, expect, it } from "vitest";
import {
  active, catalogStops, commandLine, connectionFlags, DEFAULT_SETTINGS, flagsFor, FOREVER_SECONDS, LOCAL_DUCKDB,
  LOCAL_POSTGRES, NEW_SECRET, runFlags, tableName, variation, type Pb1Settings,
} from "../settings";

const with_ = (patch: Partial<Pb1Settings>): Pb1Settings => ({ ...DEFAULT_SETTINGS, ...patch });

describe("connection flags", () => {
  it("points at the local catalogs or a secret by name", () => {
    expect(connectionFlags(with_({ catalog: LOCAL_DUCKDB }))).toEqual({ "metadata-store": "quack" });
    expect(connectionFlags(with_({ catalog: LOCAL_POSTGRES }))).toEqual({ "metadata-store": "postgres" });
    expect(connectionFlags(with_({ catalog: "ducklake_prod" }))).toEqual({ "ducklake-secret": "ducklake_prod" });
  });

  it("adds the sink and migrate, but not the sink to a reset", () => {
    expect(connectionFlags(with_({ sink: "postgres", migrate: true }))).toEqual({ "metadata-store": "quack", "data-sink": "postgres", migrate: true });
    expect(connectionFlags(with_({ mode: "RESET", sink: "postgres" }))).toEqual({ "metadata-store": "quack" });
  });
});

describe("run flags", () => {
  it("maps a batch run", () => {
    expect(runFlags(with_({ batchSize: 250_000, length: 25, flush: 4 }))).toEqual({
      "metadata-store": "quack", "run-mode": "batch", mode: "simple", "flush-interval": 4,
      "batch-size": 250_000, "num-batches": 25, distribution: "uniform",
    });
  });

  it("spreads the batch size with FINE, and TAP plays one batch", () => {
    const flags = runFlags(with_({ batchSize: 100_000, fine: 25 }), { tap: true });
    expect(flags).toMatchObject({ "batch-size-min": 75_000, "batch-size-max": 125_000, "num-batches": 1 });
  });

  it("maps ∞ to forever in both modes", () => {
    expect(runFlags(with_({ length: 0 }))["num-batches"]).toBe(0);
    expect(runFlags(with_({ mode: "STREAM", length: 0 })).duration).toBe(FOREVER_SECONDS);
  });

  it("maps a stream run, in minutes, with its anomaly rates", () => {
    const flags = runFlags(with_({ mode: "STREAM", tickInterval: 0.25, length: 5, duplicateRate: 0.1, driftRate: 0.2, partition: "day(ts)", fine: 50 }));
    expect(flags).toEqual({
      "metadata-store": "quack", "run-mode": "ticker", mode: "simple", "flush-interval": 8,
      "tick-interval": 0.25, duration: 300, "duplicate-rate": 0.1, "schema-drift-rate": 0.2,
    });
  });

  it("never sends a flag whose control is dimmed", () => {
    // VARIANT needs a rich schema and the DuckLake sink; partitioning needs the DuckLake sink.
    expect(runFlags(with_({ payload: "variant" }))).not.toHaveProperty("payload-type");
    expect(runFlags(with_({ schema: "rich", payload: "variant", sink: "postgres", partition: "user_id" }))).not.toHaveProperty("payload-type");
    expect(runFlags(with_({ sink: "postgres", partition: "user_id" }))).not.toHaveProperty("partition-by");
    expect(runFlags(with_({ sink: "postgres" }))).not.toHaveProperty("flush-interval");
    // ML labels and users are rich_ml only; conversion needs the labels on.
    expect(runFlags(with_({ schema: "rich", mlLabels: true }))).not.toHaveProperty("ml-labels");
    expect(runFlags(with_({ schema: "rich_ml" }))).not.toHaveProperty("conversion-rate");
    expect(runFlags(with_({ distribution: "uniform", span: 90 }))).not.toHaveProperty("hotspot-days");
  });

  it("sends the rich_ml flags when they apply", () => {
    expect(runFlags(with_({ schema: "rich_ml", users: 1000, mlLabels: true, conversion: 0.25, payload: "variant", distribution: "hotspot", span: 7, partition: "bucket(8, user_id)" })))
      .toMatchObject({ mode: "rich_ml", "num-users": 1000, "ml-labels": true, "conversion-rate": 0.25, "payload-type": "variant", "hotspot-days": 7, "partition-by": "bucket(8, user_id)" });
  });

  it("gives setup and reset only the connection", () => {
    expect(flagsFor(with_({ mode: "SETUP", catalog: "ducklake_prod" }))).toEqual({ "ducklake-secret": "ducklake_prod" });
    expect(flagsFor(with_({ mode: "RESET", batchSize: 1000 }))).toEqual({ "metadata-store": "quack" });
  });
});

describe("active", () => {
  it("dims what each mode doesn't use", () => {
    const batch = active(with_({ mode: "BATCH" }));
    expect([batch.fine, batch.partition, batch.distribution, batch.tap, batch.duplicate, batch.drift]).toEqual([true, true, true, true, false, false]);
    const stream = active(with_({ mode: "STREAM" }));
    expect([stream.fine, stream.partition, stream.distribution, stream.tap, stream.duplicate, stream.drift]).toEqual([false, false, false, false, true, true]);
    const setup = active(with_({ mode: "SETUP" }));
    expect([setup.tempo, setup.length, setup.schema, setup.sink]).toEqual([false, false, false, true]);
  });
});

describe("the catalog", () => {
  it("lists the local catalogs, the secrets, then + new secret", () => {
    expect(catalogStops(["ducklake_prod"])).toEqual([LOCAL_DUCKDB, LOCAL_POSTGRES, "ducklake_prod", NEW_SECRET]);
  });

  it("sets the A/B switch from the catalog", () => {
    expect(variation(LOCAL_POSTGRES)).toBe("local");
    expect(variation("ducklake_prod")).toBe("cloud");
  });

  it("names Parkbench's default table", () => {
    expect(tableName(DEFAULT_SETTINGS)).toBe("wh.events");
    expect(tableName(with_({ schema: "rich_ml", payload: "variant" }))).toBe("wh.events_rich_ml_variant");
    expect(tableName(with_({ schema: "simple", payload: "variant" }))).toBe("wh.events");
    expect(tableName(with_({ schema: "rich", sink: "postgres" }))).toBe("events_rich_source");
  });
});

describe("commandLine", () => {
  it("prints the command as typed, quoting values with spaces", () => {
    expect(commandLine("run", { "run-mode": "batch", "partition-by": "year(ts), month(ts)", "ml-labels": true, migrate: false }))
      .toBe('parkbench run --run-mode batch --partition-by "year(ts), month(ts)" --ml-labels');
  });
});
