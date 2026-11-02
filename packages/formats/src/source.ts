// A data source as files store it (presets, question sets). Only the fields for its kind
// are kept. The Python agent's request has its own shape; DH-1 converts (settings.ts).

export type SourceSpec =
  | { kind: "tpch"; tpchScale: number }
  | { kind: "db"; dbPath: string }
  | { kind: "files"; files: string[] };

export type SourceKind = SourceSpec["kind"];

export const SOURCE_KINDS: SourceKind[] = ["tpch", "db", "files"];

/** A file's source, or undefined if it has none (or one this version can't use). */
export function parseSource(value: unknown): SourceSpec | undefined {
  const s = value as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object" || !SOURCE_KINDS.includes(s.kind as SourceKind)) return undefined;
  if (s.kind === "tpch" && typeof s.tpchScale === "number" && s.tpchScale > 0) return { kind: "tpch", tpchScale: s.tpchScale };
  if (s.kind === "db" && typeof s.dbPath === "string" && s.dbPath.trim()) return { kind: "db", dbPath: s.dbPath };
  if (s.kind === "files" && Array.isArray(s.files) && s.files.length && s.files.every((f) => typeof f === "string")) {
    return { kind: "files", files: [...(s.files as string[])] };
  }
  return undefined;
}

export function sameSource(a: SourceSpec, b: SourceSpec): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The last part of a path. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/** A short description, for menus: "TPC-H 0.1", "sales.duckdb", "3 files". */
export function describeSource(source: SourceSpec): string {
  switch (source.kind) {
    case "tpch":
      return `TPC-H ${source.tpchScale}`;
    case "db":
      return baseName(source.dbPath) || "DB file";
    case "files":
      return source.files.length === 1 ? baseName(source.files[0]) : `${source.files.length} files`;
  }
}
