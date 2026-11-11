// CONFIG's form, worked out from a connector's own JSON schema in Estuary's registry, so each
// connector gets the right fields. No rendering here. Values are kept as the form holds them
// (numbers and lists as text), and buildConfig turns them into the connector's config.

export type Values = Record<string, unknown>;

interface Base {
  key: string;
  title: string;
  description?: string;
  required: boolean;
  advanced: boolean;
}

export type Field =
  | (Base & { kind: "text" | "secret" | "number" | "boolean" | "list"; multiline: boolean; defaultValue?: unknown })
  | (Base & { kind: "enum"; options: string[]; defaultValue?: unknown })
  | (Base & { kind: "group"; fields: Field[] })
  | (Base & { kind: "choice"; discriminator: string; choices: Choice[]; defaultChoice: string })
  /** A shape the form can't draw. If it's required, the form says so rather than sending nonsense. */
  | (Base & { kind: "unsupported" });

export interface Choice {
  title: string;
  value: string;
  fields: Field[];
}

type Schema = Record<string, any>;

const typeOf = (schema: Schema): string | undefined => {
  const type = schema.type;
  return Array.isArray(type) ? type.find((t) => t !== "null") : type;
};

function parseField(key: string, schema: Schema, required: boolean): Field | null {
  if ("const" in schema) return null; // Fixed: nothing to ask.
  const base: Base = {
    key,
    title: schema.title || key,
    description: schema.description,
    required,
    advanced: !!schema.advanced,
  };
  const type = typeOf(schema);
  if (Array.isArray(schema.oneOf) && schema.discriminator?.propertyName) {
    const discriminator: string = schema.discriminator.propertyName;
    const choices: Choice[] = [];
    for (const option of schema.oneOf as Schema[]) {
      const tag = option.properties?.[discriminator];
      const value = tag?.const ?? tag?.default;
      if (typeof value !== "string") continue;
      const { [discriminator]: _tag, ...rest } = option.properties ?? {};
      choices.push({ title: option.title || value, value, fields: parseFields({ properties: rest, required: option.required }) });
    }
    if (choices.length) {
      const wanted = schema.default?.[discriminator];
      const defaultChoice = choices.some((c) => c.value === wanted) ? wanted : choices[0].value;
      return { ...base, kind: "choice", discriminator, choices, defaultChoice };
    }
    return { ...base, kind: "unsupported" };
  }
  if (type === "object" && schema.properties) return { ...base, kind: "group", fields: parseFields(schema) };
  if (Array.isArray(schema.enum)) {
    const options = schema.enum.filter((o: unknown): o is string => typeof o === "string");
    return { ...base, kind: "enum", options, defaultValue: schema.default };
  }
  if (type === "array") {
    if (typeOf(schema.items ?? {}) !== "string") return { ...base, kind: "unsupported" };
    return { ...base, kind: "list", multiline: false, defaultValue: schema.default };
  }
  const simple = { ...base, multiline: !!schema.multiline, defaultValue: schema.default };
  if (type === "boolean") return { ...simple, kind: "boolean" };
  if (type === "integer" || type === "number") return { ...simple, kind: "number" };
  if (type === "string") return { ...simple, kind: schema.secret || schema.airbyte_secret ? "secret" : "text" };
  return { ...base, kind: "unsupported" };
}

export function parseFields(schema: Schema): Field[] {
  const properties: Record<string, Schema> = schema.properties ?? {};
  const required: string[] = schema.required ?? [];
  return Object.entries(properties)
    .sort(([a, x], [b, y]) => (x.order ?? 1e6) - (y.order ?? 1e6) || a.localeCompare(b))
    .map(([key, property]) => parseField(key, property, required.includes(key)))
    .filter((field): field is Field => field !== null);
}

const asText = (value: unknown) => (Array.isArray(value) ? value.join(", ") : typeof value === "number" ? String(value) : value);

/** Required fields start from the schema's defaults. Optional ones stay empty, so the connector
 *  applies its own. */
export function initialValues(fields: Field[]): Values {
  const values: Values = {};
  for (const field of fields) {
    if (!field.required) continue;
    if (field.kind === "group") values[field.key] = initialValues(field.fields);
    else if (field.kind === "choice") values[field.key] = choiceValues(field, field.defaultChoice);
    else if (field.kind !== "unsupported" && field.defaultValue !== undefined && field.defaultValue !== null) values[field.key] = asText(field.defaultValue);
    else if (field.kind === "boolean") values[field.key] = false;
  }
  return values;
}

/** The values of a choice that's just been picked. */
export function choiceValues(field: Extract<Field, { kind: "choice" }>, value: string): Values {
  const choice = field.choices.find((c) => c.value === value);
  return { [field.discriminator]: value, ...initialValues(choice?.fields ?? []) };
}

const blank = (value: unknown) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");

function hasAnything(value: unknown): boolean {
  if (value && typeof value === "object") return Object.values(value).some(hasAnything);
  return !blank(value) && value !== false;
}

const activeChoice = (field: Extract<Field, { kind: "choice" }>, value: unknown) => {
  const picked = value && typeof value === "object" ? (value as Values)[field.discriminator] : undefined;
  return field.choices.find((c) => c.value === picked);
};

/** What's stopping the form being sent, as "Title" or "Title: why". An optional group is only
 *  checked once something's in it. */
export function problems(fields: Field[], values: Values): string[] {
  const found: string[] = [];
  for (const field of fields) {
    const value = values[field.key];
    if (field.kind === "unsupported") {
      if (field.required) found.push(`${field.title}: ES-1 can't set this yet`);
    } else if (field.kind === "group") {
      if (field.required || hasAnything(value)) found.push(...problems(field.fields, (value as Values) ?? {}));
    } else if (field.kind === "choice") {
      const choice = activeChoice(field, value);
      if (choice) found.push(...problems(choice.fields, value as Values));
      else if (field.required) found.push(field.title);
    } else if (field.kind === "boolean") {
      if (field.required && value === undefined) found.push(field.title);
    } else if (blank(value)) {
      if (field.required) found.push(field.title);
    } else if (field.kind === "number" && !Number.isFinite(Number(value))) {
      found.push(`${field.title}: has to be a number`);
    }
  }
  return found;
}

/** The connector's config. Anything left empty is left out. */
export function buildConfig(fields: Field[], values: Values): Values {
  const config: Values = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.kind === "unsupported") continue;
    if (field.kind === "group") {
      const nested = buildConfig(field.fields, (value as Values) ?? {});
      if (Object.keys(nested).length) config[field.key] = nested;
    } else if (field.kind === "choice") {
      const choice = activeChoice(field, value);
      if (choice) config[field.key] = { [field.discriminator]: choice.value, ...buildConfig(choice.fields, value as Values) };
    } else if (field.kind === "boolean") {
      if (typeof value === "boolean") config[field.key] = value;
    } else if (!blank(value)) {
      if (field.kind === "number") config[field.key] = Number(value);
      else if (field.kind === "list") config[field.key] = String(value).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      else if (field.kind === "secret" || (field.kind !== "enum" && field.multiline)) config[field.key] = value; // Exactly as pasted.
      else config[field.key] = String(value).trim();
    }
  }
  return config;
}

/** Dotted paths of the secrets in these values, so the engine can check they don't come back. */
export function secretPaths(fields: Field[], values: Values, prefix = ""): string[] {
  const paths: string[] = [];
  for (const field of fields) {
    const value = values[field.key];
    const path = `${prefix}${field.key}`;
    if (field.kind === "secret") {
      if (!blank(value)) paths.push(path);
    } else if (field.kind === "group") {
      paths.push(...secretPaths(field.fields, (value as Values) ?? {}, `${path}.`));
    } else if (field.kind === "choice") {
      const choice = activeChoice(field, value);
      if (choice) paths.push(...secretPaths(choice.fields, value as Values, `${path}.`));
    }
  }
  return paths;
}

/** The same values with every secret gone, once they've been encrypted or aren't needed. */
export function withoutSecrets(fields: Field[], values: Values): Values {
  const kept: Values = { ...values };
  for (const field of fields) {
    const value = values[field.key];
    if (field.kind === "secret") delete kept[field.key];
    else if (field.kind === "group" && value) kept[field.key] = withoutSecrets(field.fields, value as Values);
    else if (field.kind === "choice" && value) {
      const choice = activeChoice(field, value);
      if (choice) kept[field.key] = withoutSecrets(choice.fields, value as Values);
    }
  }
  return kept;
}

/** How many required fields there are at the top level, and how many are filled in. */
export function requiredProgress(fields: Field[], values: Values): { filled: number; total: number } {
  const required = fields.filter((f) => f.required);
  const filled = required.filter((f) => problems([f], values).length === 0).length;
  return { filled, total: required.length };
}
