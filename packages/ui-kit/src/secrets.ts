// DuckDB's persistent secrets, as DH-1's agent manages them (duckdb_agent/duckdb_secrets.py):
// the shapes Settings and the secrets sheet use. The agent sends the types and their fields
// in hello, so the forms follow whatever it supports. Values go to the agent and never
// come back: a SecretInfo is a name, a type, and a scope.

export interface SecretField {
  key: string;
  label: string;
  /** "password" is hidden as it's typed; "secret" picks another secret of `secret_type`. */
  kind: "text" | "password" | "int" | "secret";
  required?: boolean;
  placeholder?: string;
  secret_type?: string;
}

export interface SecretType {
  type: string;
  label: string;
  /** Whether it takes a SCOPE prefix (which paths or URLs it's for). */
  scope: boolean;
  scope_hint?: string;
  fields: SecretField[];
}

export interface SecretInfo {
  name: string;
  type: string;
  provider: string;
  scope: string[];
}

export interface SecretRequest {
  name: string;
  secret_type: string;
  values: Record<string, string>;
  scope: string | null;
  /** Replace a secret of the same name (its values are typed again: they can't be read back). */
  replace: boolean;
}

/** What the host's engine can do with secrets (DH-1's agent). Each change replies with the list. */
export interface SecretsControls {
  types: SecretType[];
  list: () => Promise<SecretInfo[]>;
  create: (request: SecretRequest) => Promise<SecretInfo[]>;
  drop: (name: string) => Promise<SecretInfo[]>;
}

/** "7 saved · 5 Postgres, 1 DuckLake, 1 S3": the most common type first. */
export function secretsSummary(secrets: SecretInfo[], types: SecretType[]): string {
  if (secrets.length === 0) return "None saved";
  const label = (type: string) => types.find((t) => t.type === type)?.label ?? type;
  const counts = new Map<string, number>();
  for (const s of secrets) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  const parts = [...counts].sort((a, b) => b[1] - a[1] || label(a[0]).localeCompare(label(b[0])))
    .map(([type, n]) => `${n} ${label(type)}`);
  return `${secrets.length} saved · ${parts.join(", ")}`;
}
