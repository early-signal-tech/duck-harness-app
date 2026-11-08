import { describe, expect, it } from "vitest";
import { count, healthOf, layoutMap, parseCatalog, prefixes, sharedPrefix, withPrefix, type CatalogRow } from "../catalog";

const edges = (...names: string[]) => ({ edges: names.map((catalogName) => ({ node: { catalogName } })) });

function row(catalogName: string, catalogType: string, fields: Record<string, unknown> = {}, status = "OK"): CatalogRow {
  return { catalogName, liveSpec: { catalogType, isDisabled: status === "TASK_DISABLED", ...fields }, status: { type: status, summary: `${status} summary` } };
}

// One capture writes a collection that fans out to two materializations; a derivation reads
// another collection, which nothing writes to.
const ROWS: CatalogRow[] = [
  row("a/mat-two", "materialization", { readsFrom: edges("a/cap/orders") }, "TASK_DISABLED"),
  row("a/mat-one", "materialization", { readsFrom: edges("a/cap/orders") }),
  row("a/cap", "capture", { writesTo: edges("a/cap/orders") }, "TASK_DISABLED"),
  row("a/cap/orders", "collection", { writtenBy: edges("a/cap"), readBy: edges("a/mat-one", "a/mat-two") }),
  row("b/sales", "collection", { readBy: edges("b/cleaned") }),
  row("b/cleaned", "collection", { readsFrom: edges("b/sales") }, "WARNING"),
];

describe("parseCatalog", () => {
  it("reads the type, health and links", () => {
    const specs = parseCatalog(ROWS);
    const capture = specs.find((s) => s.name === "a/cap")!;
    expect(capture).toMatchObject({ type: "capture", health: "disabled", writesTo: ["a/cap/orders"], derived: false });
    expect(specs.find((s) => s.name === "b/cleaned")).toMatchObject({ type: "collection", derived: true, health: "alert" });
    expect(specs.find((s) => s.name === "b/sales")).toMatchObject({ derived: false, readBy: ["b/cleaned"] });
  });

  it("copes with null links and a missing status", () => {
    const [spec] = parseCatalog([{ catalogName: "a/x", liveSpec: { catalogType: "capture", writesTo: null } }]);
    expect(spec.writesTo).toEqual([]);
    expect(spec.health).toBe("alert");
    expect(spec.summary).toBe("No status reported");
  });

  it("skips what MAP doesn't draw", () => {
    expect(parseCatalog([row("a/test", "test"), { catalogName: "a/none" }])).toEqual([]);
  });
});

describe("healthOf", () => {
  it("knows the plain cases", () => {
    expect(healthOf("OK", false)).toBe("ok");
    expect(healthOf("TASK_DISABLED", true)).toBe("disabled");
    expect(healthOf("OK", true)).toBe("disabled");
    expect(healthOf("ERROR", false)).toBe("failing");
  });

  it("treats anything unknown as an alert, never as OK", () => {
    expect(healthOf("SOMETHING_NEW", false)).toBe("alert");
    expect(healthOf(undefined, false)).toBe("alert");
  });
});

describe("prefixes and counts", () => {
  const specs = parseCatalog(ROWS);

  it("lists first parts of the names", () => {
    expect(prefixes(specs)).toEqual(["a/", "b/"]);
  });

  it("filters by prefix, and null is everything", () => {
    expect(withPrefix(specs, null)).toHaveLength(6);
    expect(withPrefix(specs, "b/").map((s) => s.name).sort()).toEqual(["b/cleaned", "b/sales"]);
  });

  it("doesn't let one prefix match a longer one", () => {
    const similar = parseCatalog([row("ab/x", "capture"), row("a/y", "capture")]);
    expect(withPrefix(similar, "a/").map((s) => s.name)).toEqual(["a/y"]);
  });

  it("hides the prefix only when every name shares it", () => {
    expect(sharedPrefix(specs, null)).toBe("");
    expect(sharedPrefix(specs, "b/")).toBe("b/");
    expect(sharedPrefix(withPrefix(specs, "a/"), null)).toBe("a/");
    expect(sharedPrefix([], null)).toBe("");
  });

  it("counts a derivation as a task, and a plain collection only as a collection", () => {
    expect(count(specs)).toEqual({ tasks: 4, ok: 1, alert: 1, failing: 0, disabled: 2, collections: 3 });
  });
});

describe("layoutMap", () => {
  const layout = layoutMap(parseCatalog(ROWS));
  const rowOf = (group: "captures" | "collections" | "materializations", name: string) =>
    layout[group].find((p) => p.spec.name === name)!.row;

  it("gives every collection its own row, with each derivation under its source", () => {
    expect(layout.collections.map((p) => p.spec.name)).toEqual(["a/cap/orders", "b/sales", "b/cleaned"]);
    expect(layout.collections.map((p) => p.row)).toEqual([0, 1, 2]);
  });

  it("puts tasks next to what they're plugged into, without stacking two on a row", () => {
    expect(rowOf("captures", "a/cap")).toBe(0);
    expect(rowOf("materializations", "a/mat-one")).toBe(0);
    expect(rowOf("materializations", "a/mat-two")).toBe(1);
  });

  it("draws a cable for each link, dashed if an end is disabled", () => {
    expect(layout.cables).toEqual([
      { kind: "capture", fromRow: 0, toRow: 0, dashed: true },
      { kind: "derivation", fromRow: 1, toRow: 2, dashed: false },
      { kind: "materialization", fromRow: 0, toRow: 0, dashed: false },
      { kind: "materialization", fromRow: 0, toRow: 1, dashed: true },
    ]);
  });

  it("marks plain collections that nothing writes, but not derivations", () => {
    expect(layout.noCapture).toEqual([1]);
  });

  it("leaves out cables to specs under another prefix", () => {
    const narrowed = layoutMap(withPrefix(parseCatalog(ROWS), "a/"));
    expect(narrowed.cables).toHaveLength(3);
    const crossing = layoutMap(parseCatalog([row("a/mat", "materialization", { readsFrom: edges("b/other") })]));
    expect(crossing.cables).toEqual([]);
    expect(crossing.rows).toBe(1);
  });

  it("is empty for nothing", () => {
    expect(layoutMap([])).toEqual({ rows: 0, captures: [], collections: [], materializations: [], cables: [], noCapture: [] });
  });

  it("survives a derivation loop", () => {
    const loop = layoutMap(parseCatalog([
      row("a/x", "collection", { readsFrom: edges("a/y") }),
      row("a/y", "collection", { readsFrom: edges("a/x") }),
    ]));
    expect(loop.collections.map((p) => p.row).sort()).toEqual([0, 1]);
  });
});
