import { describe, expect, it } from "vitest";
import { describeSource, isRemotePath } from "../source";

const db = (dbPath: string, schema?: string) => describeSource({ kind: "db", dbPath, ...(schema ? { schema } : {}) });

describe("describeSource for LINE IN", () => {
  it("names a local file by its file name", () => {
    expect(db("/Users/me/data/sales.duckdb")).toBe("sales.duckdb");
    expect(db("/Users/me/data/sales.duckdb", "main")).toBe("sales.duckdb · main");
  });

  it("names a remote path the way the agent names its view, with where it lives", () => {
    expect(db("s3://bucket/orders/*.parquet")).toBe("orders · S3");
    expect(db("s3://bucket/orders/")).toBe("orders · S3");
    expect(db("s3://bucket/lake/orders/year=2026/*/*.parquet")).toBe("orders · S3");
    expect(db("s3://bucket/sales.duckdb")).toBe("sales.duckdb · S3");
    expect(db("s3a://bucket/x/data.csv")).toBe("data.csv · S3");
    expect(db("https://example.com/files/data.json")).toBe("data.json · HTTPS");
  });

  it("knows what's remote", () => {
    expect(isRemotePath(" s3://bucket/x/ ")).toBe(true);
    expect(isRemotePath("gs://bucket/x.parquet")).toBe(true);
    expect(isRemotePath("ducklake:my_catalog")).toBe(false);
    expect(isRemotePath("/Users/me/sales.duckdb")).toBe(false);
  });
});
