// The CONFIG drawer: a connector's form, built from its own schema. Secrets are masked and only
// held in memory. Required fields come first; everything optional folds away.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { choiceValues, problems, type Choice, type Field, type Values } from "./schemaForm";

interface FieldProps {
  field: Field;
  values: Values;
  onChange: (values: Values) => void;
  /** The field's full label path, unique across a form. */
  path: string;
}

function FieldRow({ field, values, onChange, path }: FieldProps) {
  const value = values[field.key];
  const set = (next: unknown) => onChange({ ...values, [field.key]: next });
  const id = `es1-config-${path}`;
  const name = <>{field.title.toUpperCase()} <em>{field.key}{field.kind === "secret" ? " · secret" : ""}</em></>;

  if (field.kind === "group") {
    return <FieldList fields={field.fields} values={(value as Values) ?? {}} onChange={set} path={path} />;
  }
  if (field.kind === "choice") {
    const picked = (value as Values | undefined)?.[field.discriminator] as string | undefined;
    const choice: Choice | undefined = field.choices.find((c) => c.value === picked);
    return (
      <>
        <label htmlFor={id} title={field.description}>
          {name}
          <select id={id} value={picked ?? ""} onChange={(e) => set(e.currentTarget.value ? choiceValues(field, e.currentTarget.value) : undefined)}>
            {!field.required && <option value="">None</option>}
            {field.required && !picked && <option value="" disabled>Choose…</option>}
            {field.choices.map((c) => <option key={c.value} value={c.value}>{c.title}</option>)}
          </select>
        </label>
        {choice && <FieldList fields={choice.fields} values={value as Values} onChange={set} path={`${path}-${choice.value}`} />}
      </>
    );
  }
  if (field.kind === "unsupported") {
    return <p className="es1-config-note" title={field.description}>{field.title}: ES-1 can't set this yet.</p>;
  }
  if (field.kind === "boolean") {
    return (
      <label className="es1-config-check" title={field.description}>
        <input type="checkbox" checked={value === true} onChange={(e) => set(e.currentTarget.checked)} />
        {name}
      </label>
    );
  }
  if (field.kind === "enum") {
    return (
      <label htmlFor={id} title={field.description}>
        {name}
        <select id={id} value={typeof value === "string" ? value : ""} onChange={(e) => set(e.currentTarget.value || undefined)}>
          <option value="">{field.required ? "Choose…" : "Connector's default"}</option>
          {field.options.map((o) => <option key={o} value={o}>{o || "(empty)"}</option>)}
        </select>
      </label>
    );
  }
  const text = typeof value === "string" ? value : "";
  const update = (next: string) => set(next);
  return (
    <label htmlFor={id} title={field.description}>
      {name}
      {/* A password box drops line breaks, which would corrupt a private key. So a multi-line
          secret gets a text area, masked with CSS. */}
      {field.multiline ? (
        <textarea id={id} rows={3} spellCheck={false} autoComplete="off" className={field.kind === "secret" ? "es1-masked" : undefined}
          value={text} onChange={(e) => update(e.currentTarget.value)} />
      ) : (
        <input id={id} type={field.kind === "secret" ? "password" : "text"} autoComplete="off" spellCheck={false} value={text}
          placeholder={field.kind === "list" ? "Separate with commas" : undefined} onChange={(e) => update(e.currentTarget.value)} />
      )}
    </label>
  );
}

function FieldList({ fields, values, onChange, path }: Omit<FieldProps, "field"> & { fields: Field[] }) {
  const flat = fields.filter((f) => f.required);
  const optional = fields.filter((f) => !f.required);
  const row = (field: Field) => <FieldRow key={field.key} field={field} values={values} onChange={onChange} path={`${path}-${field.key}`} />;
  return (
    <div className="es1-config-fields">
      {flat.map(row)}
      {optional.map((field) => (
        <details key={field.key} className="es1-config-fold">
          <summary><span>{field.title.toUpperCase()}</span><span>OPTIONAL ▸</span></summary>
          <div className="es1-config-fields">{row({ ...field })}</div>
        </details>
      ))}
    </div>
  );
}

interface Props {
  side: "source" | "destination";
  /** The connector's image and tag, for the header. */
  connector: string;
  fields: Field[] | null;
  /** Why the schema couldn't be read. */
  loadError?: string | null;
  values: Values;
  /** Why this reopened: what's missing, or why discover failed. */
  note?: string | null;
  onSave: (values: Values) => void;
  onCancel: () => void;
}

export function ConfigDrawer({ side, connector, fields, loadError, values: saved, note, onSave, onCancel }: Props) {
  const [values, setValues] = useState(saved);
  useEffect(() => setValues(saved), [saved]);
  const missing = useMemo(() => (fields ? problems(fields, values) : []), [fields, values]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(values);
  };

  return (
    <div className={`es1-drawer es1-config ${side}`} role="dialog" aria-label={`Configure ${connector}`}>
      <header>CONFIG<small>{connector}</small></header>
      <form onSubmit={submit} autoComplete="off">
        <div className="es1-config-body">
          {note && <p className="es1-drawer-note" role="alert">{note}</p>}
          {loadError && <p className="es1-drawer-note" role="alert">{loadError}</p>}
          {!fields && !loadError && <p>Reading this connector's settings…</p>}
          {fields && <FieldList fields={fields} values={values} onChange={setValues} path="root" />}
        </div>
        <footer>
          <span className="es1-config-left">
            {fields && (missing.length ? `Still needed: ${missing.length}` : "All required settings are filled in")}
          </span>
          <button type="button" className="es1-button plain" onClick={onCancel}>CANCEL</button>
          <button type="submit" className="es1-button" disabled={!fields}>SAVE CONFIG</button>
        </footer>
      </form>
    </div>
  );
}
