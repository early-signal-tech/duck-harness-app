// The secrets PB-1 can make, and their fields: the ones `parkbench secrets create` takes on
// stdin (parkbench's secrets_input.go). The kit's secrets sheet draws its form from these.
// An S3 secret's SCOPE comes from the sheet's own scope box.

import type { SecretType } from "@dh/ui-kit";

export const SECRET_TYPES: SecretType[] = [
  {
    type: "ducklake", label: "DuckLake", scope: false, fields: [
      { key: "data_path", label: "DATA PATH", kind: "text", required: true, placeholder: "s3://my-bucket/prefix" },
      { key: "metadata_secret", label: "METADATA SECRET", kind: "secret", secret_type: "postgres", required: true },
      { key: "metadata_schema", label: "METADATA SCHEMA", kind: "text", placeholder: "ducklake_meta" },
    ],
  },
  {
    type: "postgres", label: "Postgres", scope: false, fields: [
      { key: "host", label: "HOST", kind: "text", required: true, placeholder: "db.xxxx.supabase.co" },
      { key: "port", label: "PORT", kind: "int", placeholder: "5432" },
      { key: "database", label: "DATABASE", kind: "text", required: true, placeholder: "postgres" },
      { key: "user", label: "USER", kind: "text", required: true, placeholder: "postgres" },
      { key: "password", label: "PASSWORD", kind: "password", required: true },
    ],
  },
  {
    type: "s3", label: "S3", scope: true, scope_hint: "s3://my-bucket", fields: [
      { key: "key_id", label: "KEY ID", kind: "text", required: true },
      { key: "secret", label: "SECRET KEY", kind: "password", required: true },
      { key: "region", label: "REGION", kind: "text", placeholder: "us-east-1" },
    ],
  },
];
