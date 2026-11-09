// What MAP shows, worked out from `flowctl catalog list --flows`: the specs, how each one
// is doing, and where each goes on the panel. No rendering here.

interface Edges {
  edges?: { node?: { catalogName?: string } }[];
}

/** One row of `catalog list --flows -o json`. Only the fields MAP reads. */
export interface CatalogRow {
  catalogName: string;
  liveSpec?: {
    catalogType?: string;
    isDisabled?: boolean;
    readsFrom?: Edges | null;
    writesTo?: Edges | null;
    readBy?: Edges | null;
    writtenBy?: Edges | null;
  } | null;
  status?: { type?: string; summary?: string } | null;
}

export type SpecType = "capture" | "collection" | "materialization";
export type Health = "ok" | "alert" | "failing" | "disabled";

export interface Spec {
  name: string;
  type: SpecType;
  /** A collection with sources of its own: a derivation. */
  derived: boolean;
  health: Health;
  /** Estuary's own sentence about how it's doing. */
  summary: string;
  readsFrom: string[];
  writesTo: string[];
  readBy: string[];
  writtenBy: string[];
}

const names = (edges?: Edges | null): string[] =>
  (edges?.edges ?? []).map((e) => e.node?.catalogName).filter((n): n is string => !!n);

/** Anything we don't recognize is an alert: it's better to look at it than to miss it. */
export function healthOf(statusType: string | undefined, disabled: boolean): Health {
  if (disabled || statusType === "TASK_DISABLED") return "disabled";
  if (statusType === "OK") return "ok";
  if (statusType && /ERROR|FAIL/i.test(statusType)) return "failing";
  return "alert";
}

export function parseCatalog(rows: CatalogRow[]): Spec[] {
  const specs: Spec[] = [];
  for (const row of rows) {
    const type = row.liveSpec?.catalogType;
    if (type !== "capture" && type !== "collection" && type !== "materialization") continue;
    const readsFrom = names(row.liveSpec?.readsFrom);
    specs.push({
      name: row.catalogName,
      type,
      derived: type === "collection" && readsFrom.length > 0,
      health: healthOf(row.status?.type, !!row.liveSpec?.isDisabled),
      summary: row.status?.summary ?? row.status?.type ?? "No status reported",
      readsFrom,
      writesTo: names(row.liveSpec?.writesTo),
      readBy: names(row.liveSpec?.readBy),
      writtenBy: names(row.liveSpec?.writtenBy),
    });
  }
  return specs;
}

/** A catalog name's first part, as a prefix: Early_Signal/ for Early_Signal/shop/orders. */
export const prefixOf = (name: string) => `${name.split("/")[0]}/`;

/** The prefixes on the PREFIX knob. */
export const prefixes = (specs: Spec[]) => [...new Set(specs.map((s) => prefixOf(s.name)))].sort();

/** null is every prefix. */
export const withPrefix = (specs: Spec[], prefix: string | null) =>
  prefix === null ? specs : specs.filter((s) => s.name.startsWith(prefix));

/** The prefix every name here shares, so rows needn't repeat it: the one chosen, or the only
 *  one there is. Empty when there's more than one. */
export function sharedPrefix(specs: Spec[], chosen: string | null): string {
  if (chosen !== null) return chosen;
  const all = prefixes(specs);
  return all.length === 1 ? all[0] : "";
}

export interface Counts {
  tasks: number;
  ok: number;
  alert: number;
  failing: number;
  disabled: number;
  collections: number;
}

/** A plain collection isn't a task: it has no shards to fail, so it's only counted as a collection. */
export function count(specs: Spec[]): Counts {
  const tasks = specs.filter((s) => s.type !== "collection" || s.derived);
  const of = (health: Health) => tasks.filter((s) => s.health === health).length;
  return {
    tasks: tasks.length,
    ok: of("ok"),
    alert: of("alert"),
    failing: of("failing"),
    disabled: of("disabled"),
    collections: specs.filter((s) => s.type === "collection").length,
  };
}

export interface Placed {
  spec: Spec;
  row: number;
}

export interface Cable {
  kind: "capture" | "derivation" | "materialization";
  fromRow: number;
  toRow: number;
  /** An end is disabled, so nothing flows through it. */
  dashed: boolean;
}

export interface MapLayout {
  rows: number;
  captures: Placed[];
  collections: Placed[];
  materializations: Placed[];
  cables: Cable[];
  /** Rows whose collection nothing here writes to. */
  noCapture: number[];
}

const byName = (a: Spec, b: Spec) => a.name.localeCompare(b.name);

/** Lay the specs out by rows: a collection per row, each in order of what feeds it, and each
 *  task next to the first thing it's plugged into. Links to specs outside `specs` (another
 *  prefix) aren't drawn. */
export function layoutMap(specs: Spec[]): MapLayout {
  const known = new Map(specs.map((s) => [s.name, s]));
  const captures = specs.filter((s) => s.type === "capture").sort(byName);
  const materializations = specs.filter((s) => s.type === "materialization").sort(byName);
  const collections = specs.filter((s) => s.type === "collection").sort(byName);

  // Links can be listed on either end, so read both.
  const captureTargets = (task: Spec) =>
    collections.filter((c) => task.writesTo.includes(c.name) || c.writtenBy.includes(task.name));
  const materializationSources = (task: Spec) =>
    collections.filter((c) => task.readsFrom.includes(c.name) || c.readBy.includes(task.name));
  const derivationsOf = (c: Spec) => collections.filter((d) => d.derived && d.readsFrom.includes(c.name));

  // Each capture's collections together, each derivation under what it reads.
  const row = new Map<string, number>();
  const visit = (c: Spec) => {
    if (row.has(c.name)) return;
    row.set(c.name, row.size);
    derivationsOf(c).forEach(visit);
  };
  captures.forEach((task) => captureTargets(task).forEach(visit));
  collections.filter((c) => !c.derived || !c.readsFrom.some((name) => known.has(name))).forEach(visit);
  collections.forEach(visit); // Whatever's left is a derivation loop.

  const place = (tasks: Spec[], firstRow: (task: Spec) => number): Placed[] => {
    const taken = new Set<number>();
    return tasks.map((spec) => {
      let at = firstRow(spec);
      while (taken.has(at)) at++;
      taken.add(at);
      return { spec, row: at };
    });
  };
  const firstOf = (linked: Spec[]) => Math.min(...linked.map((c) => row.get(c.name)!), Infinity);
  const onRow = (linked: Spec[]) => (linked.length ? firstOf(linked) : 0);
  const placedCaptures = place(captures, (t) => onRow(captureTargets(t)));
  const placedMaterializations = place(materializations, (t) => onRow(materializationSources(t)));
  const placedCollections = collections.map((spec) => ({ spec, row: row.get(spec.name)! })).sort((a, b) => a.row - b.row);

  const off = (spec: Spec) => spec.health === "disabled";
  const cables: Cable[] = [];
  for (const { spec, row: at } of placedCaptures) {
    for (const c of captureTargets(spec)) {
      cables.push({ kind: "capture", fromRow: at, toRow: row.get(c.name)!, dashed: off(spec) });
    }
  }
  for (const c of collections.filter((d) => d.derived)) {
    for (const source of c.readsFrom.filter((name) => row.has(name))) {
      cables.push({ kind: "derivation", fromRow: row.get(source)!, toRow: row.get(c.name)!, dashed: off(c) });
    }
  }
  for (const { spec, row: at } of placedMaterializations) {
    for (const c of materializationSources(spec)) {
      cables.push({ kind: "materialization", fromRow: row.get(c.name)!, toRow: at, dashed: off(spec) });
    }
  }

  const captureRows = new Set(placedCaptures.map((p) => p.row));
  const written = new Set(placedCaptures.flatMap((p) => captureTargets(p.spec).map((c) => c.name)));
  const noCapture = placedCollections
    .filter((p) => !p.spec.derived && !written.has(p.spec.name) && p.spec.writtenBy.length === 0 && !captureRows.has(p.row))
    .map((p) => p.row);

  const lastRow = Math.max(-1, ...[...placedCaptures, ...placedCollections, ...placedMaterializations].map((p) => p.row));
  return {
    rows: lastRow + 1,
    captures: placedCaptures,
    collections: placedCollections,
    materializations: placedMaterializations,
    cables,
    noCapture,
  };
}
