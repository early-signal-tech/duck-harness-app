import { describe, expect, it } from "vitest";
import { buildConfig, choiceValues, initialValues, parseFields, problems, requiredProgress, secretPaths, withoutSecrets, type Field } from "../schemaForm";

// The shapes of source-postgres and materialize-motherduck in Estuary's registry.
const SCHEMA = {
  type: "object",
  required: ["address", "user", "historyMode", "credentials"],
  properties: {
    address: { type: "string", title: "Server Address", order: 0 },
    user: { type: "string", default: "flow_capture", order: 1 },
    historyMode: { type: "boolean", default: false, order: 3 },
    credentials: {
      type: "object",
      title: "Authentication",
      order: 4,
      default: { auth_type: "UserPassword" },
      discriminator: { propertyName: "auth_type" },
      oneOf: [
        { title: "Password", required: ["auth_type", "password"], properties: { auth_type: { const: "UserPassword", default: "UserPassword" }, password: { type: "string", secret: true } } },
        { title: "AWS IAM", required: ["auth_type", "aws_region"], properties: { auth_type: { const: "AWSIAM" }, aws_region: { type: "string" } } },
      ],
    },
    discoveryFilters: { type: "object", title: "Filters", properties: { include_schemas: { type: "array", items: { type: "string" } }, count: { type: "integer" } } },
    advanced: { type: "object", advanced: true, properties: { sslmode: { type: "string", enum: ["disable", "require"] }, slot: { type: ["string", "null"], default: "flow_slot" } } },
    networkTunnel: { type: "object", properties: { sshForwarding: { type: "object", required: ["sshEndpoint", "privateKey"], properties: { sshEndpoint: { type: "string" }, privateKey: { type: "string", secret: true, multiline: true } } } } },
    clusters: { type: "array", items: { type: "object" } },
  },
};

const fields = parseFields(SCHEMA);
const field = (key: string) => fields.find((f) => f.key === key) as Field;
const complete = { address: "db:5432", user: "me", historyMode: false, credentials: { auth_type: "UserPassword", password: " made up " } };

describe("parseFields", () => {
  it("keeps the schema's order, and knows which are required", () => {
    expect(fields.slice(0, 4).map((f) => f.key)).toEqual(["address", "user", "historyMode", "credentials"]);
    expect(field("address")).toMatchObject({ required: true, title: "Server Address", kind: "text" });
    expect(field("discoveryFilters").required).toBe(false);
  });

  it("recognizes each kind, including nullable types", () => {
    expect(field("historyMode").kind).toBe("boolean");
    const advanced = field("advanced") as Extract<Field, { kind: "group" }>;
    expect(advanced.advanced).toBe(true);
    expect(advanced.fields.map((f) => [f.key, f.kind])).toEqual([["slot", "text"], ["sslmode", "enum"]]);
    const filters = field("discoveryFilters") as Extract<Field, { kind: "group" }>;
    expect(filters.fields.map((f) => f.kind).sort()).toEqual(["list", "number"]);
  });

  it("reads a oneOf as a choice, and marks secrets", () => {
    const credentials = field("credentials") as Extract<Field, { kind: "choice" }>;
    expect(credentials.discriminator).toBe("auth_type");
    expect(credentials.defaultChoice).toBe("UserPassword");
    expect(credentials.choices.map((c) => c.title)).toEqual(["Password", "AWS IAM"]);
    expect(credentials.choices[0].fields).toMatchObject([{ key: "password", kind: "secret", required: true }]);
  });

  it("marks what it can't draw, and stops if that's required", () => {
    expect(field("clusters").kind).toBe("unsupported");
    const required = parseFields({ required: ["x"], properties: { x: { type: "array", items: { type: "object" } } } });
    expect(problems(required, {})).toEqual(["x: ES-1 can't set this yet"]);
  });

  it("handles a schema with nothing in it", () => {
    expect(parseFields({})).toEqual([]);
  });
});

describe("values", () => {
  it("starts required fields from their defaults, and leaves optional ones empty", () => {
    expect(initialValues(fields)).toEqual({ user: "flow_capture", historyMode: false, credentials: { auth_type: "UserPassword" } });
  });

  it("starts a newly picked choice with its own defaults", () => {
    expect(choiceValues(field("credentials") as Extract<Field, { kind: "choice" }>, "AWSIAM")).toEqual({ auth_type: "AWSIAM" });
  });

  it("says what's missing, for the choice that's picked", () => {
    expect(problems(fields, initialValues(fields))).toEqual(["Server Address", "password"]);
    expect(problems(fields, { ...complete, credentials: { auth_type: "AWSIAM" } })).toEqual(["aws_region"]);
    expect(problems(fields, complete)).toEqual([]);
  });

  it("only checks an optional group once it has something in it", () => {
    expect(problems(fields, { ...complete, networkTunnel: { sshForwarding: { sshEndpoint: "x" } } })).toEqual(["privateKey"]);
    expect(problems(fields, { ...complete, networkTunnel: { sshForwarding: { sshEndpoint: " " } } })).toEqual([]);
  });

  it("checks numbers", () => {
    expect(problems(fields, { ...complete, discoveryFilters: { count: "many" } })).toEqual(["count: has to be a number"]);
  });

  it("counts required fields", () => {
    expect(requiredProgress(fields, initialValues(fields))).toEqual({ filled: 2, total: 4 });
    expect(requiredProgress(fields, complete)).toEqual({ filled: 4, total: 4 });
  });
});

describe("buildConfig", () => {
  it("leaves out what's empty, and keeps the discriminator", () => {
    expect(buildConfig(fields, { ...complete, advanced: { slot: "" }, discoveryFilters: {} })).toEqual({
      address: "db:5432", user: "me", historyMode: false, credentials: { auth_type: "UserPassword", password: " made up " },
    });
  });

  it("converts numbers and lists, trims text, and leaves secrets exactly as pasted", () => {
    const config = buildConfig(fields, { ...complete, address: " db ", discoveryFilters: { count: "7", include_schemas: "public, sales\nops," } });
    expect(config.address).toBe("db");
    expect(config.discoveryFilters).toEqual({ count: 7, include_schemas: ["public", "sales", "ops"] });
    expect((config.credentials as Record<string, unknown>).password).toBe(" made up ");
  });

  it("only sends the picked choice's fields", () => {
    const config = buildConfig(fields, { ...complete, credentials: { auth_type: "AWSIAM", aws_region: "us", password: "old" } });
    expect(config.credentials).toEqual({ auth_type: "AWSIAM", aws_region: "us" });
  });
});

describe("secrets", () => {
  const withTunnel = { ...complete, networkTunnel: { sshForwarding: { sshEndpoint: "x", privateKey: "made up key" } } };

  it("finds the path of each one that's set", () => {
    expect(secretPaths(fields, withTunnel)).toEqual(["credentials.password", "networkTunnel.sshForwarding.privateKey"]);
    expect(secretPaths(fields, initialValues(fields))).toEqual([]);
    expect(secretPaths(fields, { ...complete, credentials: { auth_type: "AWSIAM", password: "old" } })).toEqual([]);
  });

  it("can remove all of them, and only them", () => {
    const kept = withoutSecrets(fields, withTunnel);
    expect(JSON.stringify(kept)).not.toContain("made up");
    expect(kept).toMatchObject({ address: "db:5432", credentials: { auth_type: "UserPassword" }, networkTunnel: { sshForwarding: { sshEndpoint: "x" } } });
  });
});
