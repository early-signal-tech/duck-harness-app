// SOURCE: what the agent queries. Test tone (generated TPC-H), line in (a DuckDB file or
// ducklake: URI, opened read-only), or the sampler (CSV / Parquet / JSON files loaded
// into memory).

import { open } from "@tauri-apps/plugin-dialog";
import { fileName, TPCH_SCALES, type FaceSettings, type SourceKind } from "../settings";

interface Props {
  settings: FaceSettings;
  update: (patch: Partial<FaceSettings>) => void;
}

const KINDS: { kind: SourceKind; label: string; sub: string }[] = [
  { kind: "tpch", label: "TEST TONE", sub: "TPC-H" },
  { kind: "db", label: "LINE IN", sub: "DB file" },
  { kind: "files", label: "SAMPLER", sub: "files" },
];

export function SourcePanel({ settings, update }: Props) {
  async function chooseDb() {
    const path = await open({
      title: "Choose a DuckDB database",
      filters: [{ name: "DuckDB", extensions: ["duckdb", "db", "ddb"] }, { name: "All files", extensions: ["*"] }],
    });
    if (typeof path === "string") update({ dbPath: path });
  }

  async function addFiles() {
    const paths = await open({
      title: "Add data files",
      multiple: true,
      filters: [{ name: "Data", extensions: ["csv", "tsv", "parquet", "json", "jsonl", "ndjson", "gz"] }],
    });
    if (Array.isArray(paths) && paths.length) {
      update({ files: [...new Set([...settings.files, ...paths])] });
    }
  }

  return (
    <section className="panel source">
      <h2>SOURCE</h2>
      <div className="segmented three" role="radiogroup" aria-label="Source">
        {KINDS.map(({ kind, label, sub }) => (
          <button
            key={kind}
            role="radio"
            aria-checked={settings.sourceKind === kind}
            className={settings.sourceKind === kind ? "on" : ""}
            onClick={() => update({ sourceKind: kind })}
          >
            <span className="led" />
            {label}
            <small>{sub}</small>
          </button>
        ))}
      </div>

      <div className="source-body">
        {settings.sourceKind === "tpch" && (
          <>
            <p className="note">Generated TPC-H data in memory: orders, customers, line items, parts, suppliers.</p>
            <span className="field-label">SCALE</span>
            <div className="segmented" role="radiogroup" aria-label="TPC-H scale">
              {TPCH_SCALES.map((scale) => (
                <button
                  key={scale}
                  role="radio"
                  aria-checked={settings.tpchScale === scale}
                  className={settings.tpchScale === scale ? "on" : ""}
                  onClick={() => update({ tpchScale: scale })}
                >
                  {scale}
                </button>
              ))}
            </div>
            <p className="note dim">0.1 ≈ 100 MB, built in a few seconds on first run.</p>
          </>
        )}

        {settings.sourceKind === "db" && (
          <>
            <span className="field-label">DATABASE · OPENED READ-ONLY</span>
            <div className="path-row">
              <input
                value={settings.dbPath}
                placeholder="/path/to/data.duckdb or ducklake:…"
                spellCheck={false}
                onChange={(e) => update({ dbPath: e.currentTarget.value })}
              />
              <button onClick={chooseDb}>Browse…</button>
            </div>
          </>
        )}

        {settings.sourceKind === "files" && (
          <>
            <span className="field-label">LOADED TABLES</span>
            <ul className="file-list">
              {settings.files.length === 0 && <li className="dim">No files yet</li>}
              {settings.files.map((path) => (
                <li key={path} title={path}>
                  <span>{fileName(path)}</span>
                  <button
                    className="x"
                    aria-label={`Remove ${fileName(path)}`}
                    onClick={() => update({ files: settings.files.filter((p) => p !== path) })}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={addFiles}>Add files…</button>
          </>
        )}
      </div>
    </section>
  );
}
