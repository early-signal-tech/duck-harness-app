// SOURCE: what the agent queries. Test tone (generated TPC-H), line in (a DuckDB file or
// ducklake: URI, opened read-only), or the sampler (CSV / Parquet / JSON files loaded
// into memory; drop them anywhere on the window).

import { open } from "@tauri-apps/plugin-dialog";
import { Knob } from "@dh/ui-kit";
import { fileName, tableNameFor, TPCH_SCALES, type FaceSettings, type SourceKind } from "../settings";

interface Props {
  settings: FaceSettings;
  update: (patch: Partial<FaceSettings>) => void;
  addFiles: (paths: string[]) => void;
}

// TPC-H data is about 1 GB per unit of scale. It's built on the first run at a scale
// and reused after that, until the app restarts.
const SCALE_NOTES: Record<number, string> = {
  0.01: "0.01 ≈ 10 MB. Builds almost instantly.",
  0.1: "0.1 ≈ 100 MB. Builds in a few seconds.",
  1: "1 ≈ 1 GB. The first run takes longer while it builds.",
};

const KINDS: { kind: SourceKind; label: string }[] = [
  { kind: "tpch", label: "TEST TONE" },
  { kind: "db", label: "LINE IN" },
  { kind: "files", label: "SAMPLER" },
];

export function SourcePanel({ settings, update, addFiles }: Props) {
  async function chooseDb() {
    const path = await open({
      title: "Choose a DuckDB database",
      filters: [{ name: "DuckDB", extensions: ["duckdb", "db", "ddb"] }, { name: "All files", extensions: ["*"] }],
    });
    if (typeof path === "string") update({ dbPath: path });
  }

  async function pickFiles() {
    const paths = await open({
      title: "Add data files",
      multiple: true,
      filters: [{ name: "Data", extensions: ["csv", "tsv", "parquet", "json", "jsonl", "ndjson", "gz"] }],
    });
    if (Array.isArray(paths) && paths.length) addFiles(paths);
  }

  const scaleIndex = Math.max(0, TPCH_SCALES.indexOf(settings.tpchScale as (typeof TPCH_SCALES)[number]));

  return (
    <section className="panel source">
      <h2>SOURCE</h2>
      <div className="segmented" role="radiogroup" aria-label="Source">
        {KINDS.map(({ kind, label }) => (
          <button
            key={kind}
            role="radio"
            aria-checked={settings.sourceKind === kind}
            className={settings.sourceKind === kind ? "on" : ""}
            onClick={() => update({ sourceKind: kind })}
          >
            {label}
          </button>
        ))}
      </div>

      {settings.sourceKind === "tpch" && (
        <div className="tone">
          <Knob
            label="SCALE"
            size="small"
            value={scaleIndex}
            min={0}
            max={TPCH_SCALES.length - 1}
            defaultValue={1}
            format={(i) => String(TPCH_SCALES[i])}
            onChange={(i) => update({ tpchScale: TPCH_SCALES[i] })}
          />
          <div className="tone-text">
            <span className="caps">TEST TONE · TPC-H</span>
            <span className="small muted">Generated orders, customers, line items, parts, and suppliers, in memory.</span>
            <span className="small muted">{SCALE_NOTES[settings.tpchScale] ?? `Scale ${settings.tpchScale}.`}</span>
          </div>
        </div>
      )}

      {settings.sourceKind === "db" && (
        <div className="field">
          <label className="caps muted" htmlFor="line-in">LINE IN · DB FILE / DUCKLAKE</label>
          <input
            id="line-in"
            value={settings.dbPath}
            placeholder="/path/to/data.duckdb"
            spellCheck={false}
            onChange={(e) => update({ dbPath: e.currentTarget.value })}
          />
          <button className="small-button" onClick={chooseDb}>Browse…</button>
          <span className="small muted">Opened read-only.</span>
        </div>
      )}

      {settings.sourceKind === "files" && (
        <>
          <button className="dropzone" onClick={pickFiles}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
            <span className="strong">Drop data files</span>
            <span className="small muted">CSV · Parquet · JSON, or click to choose</span>
          </button>
          <div className="field">
            <span className="caps muted">LOADED TABLES</span>
            <ul className="tables">
              {settings.files.length === 0 && <li className="muted">None yet</li>}
              {settings.files.map((path) => (
                <li key={path} title={path}>
                  <span>{tableNameFor(path)}</span>
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
          </div>
        </>
      )}
    </section>
  );
}
