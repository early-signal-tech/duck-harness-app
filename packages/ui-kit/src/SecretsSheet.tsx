// The DuckDB secrets sheet, opened from Settings (Manage…): the saved secrets, and a form
// to add one or replace one. A secret's values are typed here, sent to the agent, and
// forgotten: they're never read back, so replacing a secret means typing them again.
// Esc goes back from the form to the list, and closes the sheet from the list.

import { useEffect, useState } from "react";
import type { SecretInfo, SecretRequest, SecretsControls, SecretType } from "./secrets";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

type View = { kind: "list" } | { kind: "form"; replacing: SecretInfo | null };

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function SecretsSheet({ controls, onClose }: { controls: SecretsControls; onClose: () => void }) {
  const [secrets, setSecrets] = useState<SecretInfo[] | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    controls.list().then(setSecrets).catch((e) => setNote({ text: message(e), error: true }));
  }, [controls]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (view.kind === "form") setView({ kind: "list" });
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [view, onClose]);

  const typeLabel = (type: string) => controls.types.find((t) => t.type === type)?.label ?? type;

  const drop = async (name: string) => {
    setWorking(true);
    setNote(null);
    try {
      setSecrets(await controls.drop(name));
      setNote({ text: `Deleted ${name}.` });
    } catch (e) {
      setNote({ text: message(e), error: true });
    } finally {
      setWorking(false);
      setConfirmDrop(null);
    }
  };

  const save = async (request: SecretRequest) => {
    setWorking(true);
    setNote(null);
    try {
      setSecrets(await controls.create(request));
      setView({ kind: "list" });
      setNote({ text: `${request.replace ? "Replaced" : "Saved"} ${request.name}.` });
    } catch (e) {
      setNote({ text: message(e), error: true });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="sheet-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet secrets-sheet" role="dialog" aria-modal="true" aria-label="DuckDB secrets">
        <header className="sheet-head">
          <span className="settings-label">DUCKDB SECRETS</span>
          {view.kind === "list" && (
            <button className="pane-button" disabled={working} onClick={() => { setNote(null); setView({ kind: "form", replacing: null }); }}>
              + Add
            </button>
          )}
          <span className="spacer" />
          <button className="sheet-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {view.kind === "list" ? (
          <div className="sheet-body">
            <p className="settings-hint">
              Saved in DuckDB's own store, <span className="mono">~/.duckdb/stored_secrets</span>: unencrypted, readable
              only by your Mac user. The agent and the <span className="mono">duckdb</span> command line use the same ones.
            </p>
            {secrets === null ? (
              <p className="settings-hint">{note?.error ? "" : "Reading…"}</p>
            ) : secrets.length === 0 ? (
              <p className="settings-hint">None saved yet: + Add makes one.</p>
            ) : (
              <ul className="secrets-list">
                {secrets.map((s) => (
                  <li key={s.name} className="secret-row">
                    <span className="secret-name mono">{s.name}</span>
                    <span className="secret-type">{typeLabel(s.type).toUpperCase()}</span>
                    <span className="secret-scope mono" title={s.scope.join(", ")}>{s.scope.join(", ")}</span>
                    {confirmDrop === s.name ? (
                      <span className="secret-actions">
                        <span className="settings-hint warn">Delete it?</span>
                        <button className="pane-button" onClick={() => setConfirmDrop(null)}>Keep</button>
                        <button className="pane-button danger" disabled={working} onClick={() => void drop(s.name)}>Delete</button>
                      </span>
                    ) : (
                      <span className="secret-actions">
                        <button className="pane-button" disabled={working || !controls.types.some((t) => t.type === s.type)}
                          title={controls.types.some((t) => t.type === s.type) ? "Type its values again" : "This type can't be edited here"}
                          onClick={() => { setNote(null); setView({ kind: "form", replacing: s }); }}>
                          Replace
                        </button>
                        <button className="pane-button" disabled={working} onClick={() => setConfirmDrop(s.name)}>Delete</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <SecretForm
            types={controls.types}
            secrets={secrets ?? []}
            replacing={view.replacing}
            working={working}
            onCancel={() => { setNote(null); setView({ kind: "list" }); }}
            onSave={(request) => void save(request)}
          />
        )}

        {(working || note) && (
          <p className={`settings-note sheet-note${note?.error ? " error" : ""}`} aria-live="polite">
            {working ? "Working…" : note?.text}
          </p>
        )}
      </div>
    </div>
  );
}

function SecretForm({ types, secrets, replacing, working, onCancel, onSave }: {
  types: SecretType[];
  secrets: SecretInfo[];
  replacing: SecretInfo | null;
  working: boolean;
  onCancel: () => void;
  onSave: (request: SecretRequest) => void;
}) {
  const [typeName, setTypeName] = useState(replacing?.type ?? types[0]?.type ?? "");
  const type = types.find((t) => t.type === typeName) ?? types[0];
  const [name, setName] = useState(replacing?.name ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  // A secret's own default scope (s3://, s3n://, ...) isn't one to keep when replacing.
  const [scope, setScope] = useState(replacing && replacing.scope.length === 1 ? replacing.scope[0] : "");

  const taken = !replacing && secrets.some((s) => s.name === name.trim());
  const missing = type?.fields.filter((f) => f.required && !(values[f.key] ?? "").trim()) ?? [];
  const nameProblem = !name.trim() ? null : !NAME.test(name.trim()) ? "Letters, digits, and _; not starting with a digit." : taken ? "That name is taken: Replace it from the list." : null;
  const canSave = !!type && !!name.trim() && !nameProblem && missing.length === 0 && !working;

  const ofType = (secretType: string) => secrets.filter((s) => s.type === secretType);

  if (!type) return <div className="sheet-body"><p className="settings-hint">The agent offers no secret types.</p></div>;

  return (
    <form
      className="sheet-body secret-form"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
        onSave({ name: name.trim(), secret_type: type.type, values: filled, scope: type.scope && scope.trim() ? scope.trim() : null, replace: !!replacing });
      }}
    >
      {replacing ? (
        <p className="settings-hint">
          Replacing <span className="mono">{replacing.name}</span>: type its values again (saved ones can't be read back).
        </p>
      ) : (
        <div className="secret-types" role="radiogroup" aria-label="Type">
          {types.map((t) => (
            <button key={t.type} type="button" role="radio" aria-checked={t.type === type.type}
              className={`toggle small${t.type === type.type ? " on" : ""}`}
              onClick={() => { setTypeName(t.type); setValues({}); setScope(""); }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      <label className="secret-field">
        <span className="settings-label">NAME</span>
        <input value={name} disabled={!!replacing} spellCheck={false} placeholder="e.g. s3_main"
          onChange={(e) => setName(e.currentTarget.value)} />
        {nameProblem && <span className="settings-hint warn">{nameProblem}</span>}
      </label>

      {type.fields.map((f) => (
        <label key={`${type.type}.${f.key}`} className="secret-field">
          <span className="settings-label">{f.label.toUpperCase()}{f.required ? " *" : ""}</span>
          {f.kind === "secret" ? (
            <select value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.currentTarget.value })}>
              <option value="">None</option>
              {ofType(f.secret_type ?? "").map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          ) : (
            <input
              type={f.kind === "password" ? "password" : "text"}
              inputMode={f.kind === "int" ? "numeric" : undefined}
              autoComplete={f.kind === "password" ? "new-password" : "off"}
              spellCheck={false}
              placeholder={f.placeholder}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues({ ...values, [f.key]: e.currentTarget.value })}
            />
          )}
        </label>
      ))}

      {type.scope && (
        <label className="secret-field">
          <span className="settings-label">SCOPE</span>
          <input value={scope} spellCheck={false} placeholder={type.scope_hint ? `${type.scope_hint} (optional)` : "optional"}
            onChange={(e) => setScope(e.currentTarget.value)} />
          <span className="settings-hint">Which paths it's for. Empty: every {type.label} path.</span>
        </label>
      )}

      <div className="settings-row sheet-actions">
        <button type="button" className="pane-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="pane-button primary" disabled={!canSave}>{replacing ? "Replace" : "Save"}</button>
      </div>
    </form>
  );
}
