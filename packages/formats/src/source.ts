// A data source as files store it (presets, question sets). Only the fields for its kind
// are kept. The Python agent's request has its own shape; DH-1 converts (settings.ts).

export type SourceSpec =
  | { kind: "tpch"; tpchScale: number }
  /** A DuckDB file or ducklake: URI, or a remote path (s3://bucket/sales.duckdb, or data
   *  files read in place: s3://bucket/orders/*.parquet); `schema` is where the agent's
   *  unqualified SQL runs. */
  | { kind: "db"; dbPath: string; schema?: string }
  | { kind: "files"; files: string[] };

export type SourceKind = SourceSpec["kind"];

export const SOURCE_KINDS: SourceKind[] = ["tpch", "db", "files"];

/** A file's source, or undefined if it has none (or one this version can't use). */
export function parseSource(value: unknown): SourceSpec | undefined {
  const s = value as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object" || !SOURCE_KINDS.includes(s.kind as SourceKind)) return undefined;
  if (s.kind === "tpch" && typeof s.tpchScale === "number" && s.tpchScale > 0) return { kind: "tpch", tpchScale: s.tpchScale };
  if (s.kind === "db" && typeof s.dbPath === "string" && s.dbPath.trim()) {
    if (s.schema !== undefined && (typeof s.schema !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.schema))) return undefined;
    return { kind: "db", dbPath: s.dbPath, ...(s.schema ? { schema: s.schema as string } : {}) };
  }
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

const REMOTE = /^(s3a?|s3n|r2|gs|gcs|https?|hf|az|abfss):\/\//i;

/** Whether a LINE IN path is remote (read with the machine's DuckDB secrets). */
export function isRemotePath(path: string): boolean {
  return REMOTE.test(path.trim());
}

/** A remote path's name, the way the agent names its view: the file, or the folder it
 *  reads (s3://bucket/orders/*.parquet and s3://bucket/orders/year=2026/ -> "orders"). */
function remoteName(path: string): string {
  const parts = path.replace(REMOTE, "").replace(/\/+$/, "").split("/")
    .filter((p) => p && !/[*?[{]/.test(p) && !p.includes("="));
  return parts[parts.length - 1] ?? "";
}

/** A short description, for menus: "TPC-H 0.1", "sales.duckdb", "orders · S3", "3 files". */
export function describeSource(source: SourceSpec): string {
  switch (source.kind) {
    case "tpch":
      return `TPC-H ${source.tpchScale}`;
    case "db": {
      const remote = source.dbPath.trim().match(REMOTE);
      const name = remote
        ? `${remoteName(source.dbPath) || "data"} · ${remote[1].replace(/^s3[an]$/i, "s3").toUpperCase()}`
        : baseName(source.dbPath) || "DB file";
      return name + (source.schema ? ` · ${source.schema}` : "");
    }
    case "files":
      return source.files.length === 1 ? baseName(source.files[0]) : `${source.files.length} files`;
  }
}
