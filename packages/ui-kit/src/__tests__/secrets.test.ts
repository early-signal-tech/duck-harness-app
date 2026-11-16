import { describe, expect, it } from "vitest";
import { secretsSummary, type SecretInfo, type SecretType } from "../secrets";

const types: SecretType[] = [
  { type: "s3", label: "S3", scope: true, fields: [] },
  { type: "postgres", label: "Postgres", scope: false, fields: [] },
  { type: "ducklake", label: "DuckLake", scope: false, fields: [] },
];
const secret = (name: string, type: string): SecretInfo => ({ name, type, provider: "config", scope: [] });

describe("secretsSummary", () => {
  it("counts by type, the most common first", () => {
    const secrets = [secret("a", "postgres"), secret("b", "s3"), secret("c", "postgres"), secret("d", "ducklake")];
    expect(secretsSummary(secrets, types)).toBe("4 saved · 2 Postgres, 1 DuckLake, 1 S3");
  });

  it("says when there are none, and names a type the agent didn't describe", () => {
    expect(secretsSummary([], types)).toBe("None saved");
    expect(secretsSummary([secret("x", "azure")], types)).toBe("1 saved · 1 azure");
  });
});
