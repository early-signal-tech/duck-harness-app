// A stand-in for Parkbench, so the panel's knobs, switches and sequencer can be built and
// checked before the real engine is wired in. It reads the same flags Parkbench would get
// (settings.ts) and writes the same events (events.ts), paced so a run looks alive: real
// tick intervals in STREAM, and a few batches a second in BATCH. Nothing touches a database.

import type { SecretInfo, SecretRequest, SecretType } from "@dh/ui-kit";
import { Pb1Error, type Pb1Engine, type Running } from "./engine";
import type { DoneEvent, DoneReason, RunEvent } from "./events";
import type { Flags } from "./settings";

export const FAKE_SECRET_TYPES: SecretType[] = [
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

const STARTING_SECRETS: SecretInfo[] = [
  { name: "supabase_pg", type: "postgres", provider: "config", scope: [] },
  { name: "ducklake_prod", type: "ducklake", provider: "config", scope: [] },
  { name: "ducklake_stage", type: "ducklake", provider: "config", scope: [] },
];

export interface FakeOptions {
  /** Ask before a reset, as the host will. Resolves true to go ahead. */
  confirm: (title: string, message: string) => Promise<boolean>;
  random?: () => number;
  /** Milliseconds to wait between batches (tests pass 0). */
  batchPace?: (batchSize: number) => number;
  /** Milliseconds per second of ticker time (tests pass 0). */
  tickScale?: number;
}

const num = (flags: Flags, flag: string, fallback: number) => (typeof flags[flag] === "number" ? (flags[flag] as number) : fallback);
const str = (flags: Flags, flag: string, fallback: string) => (typeof flags[flag] === "string" ? (flags[flag] as string) : fallback);

/** Where the flags point, for messages: a secret's name, or which local catalog. */
export function catalogLabel(flags: Flags): string {
  if (typeof flags["ducklake-secret"] === "string") return flags["ducklake-secret"];
  return flags["metadata-store"] === "duckdb" ? "local duckdb" : "local postgres";
}

/** What the reset dialog says. A secret's catalog is shared, so only its tables go. */
export function resetMessage(flags: Flags): string {
  return typeof flags["ducklake-secret"] === "string"
    ? `Drops events, events_rich and events_rejected in ${flags["ducklake-secret"]}, then runs setup again. Parquet files already written stay.`
    : `Deletes the ${catalogLabel(flags)} catalog and its data folder, then runs setup again.`;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function fakeEngine(options: FakeOptions): Pb1Engine {
  const random = options.random ?? Math.random;
  const batchPace = options.batchPace ?? ((size) => Math.max(140, Math.min(900, Math.log10(size) * 110)));
  const tickScale = options.tickScale ?? 1000;
  let secrets = STARTING_SECRETS.slice();

  return {
    async setup(flags) {
      await wait(tickScale ? 700 : 0);
      return `Setup complete: events, events_rich, events_rejected in ${catalogLabel(flags)}`;
    },

    async reset(flags) {
      if (!(await options.confirm("Reset this catalog?", resetMessage(flags)))) throw new Pb1Error("Not reset: cancelled.", "cancelled");
      await wait(tickScale ? 900 : 0);
      return `Reset ${catalogLabel(flags)}: tables recreated`;
    },

    run(flags, onEvent): Running {
      let stopped = false;
      let wake: () => void = () => {};
      const pause = (ms: number) => new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        wake = () => { clearTimeout(timer); resolve(); };
      });
      const started = Date.now();
      const elapsed = () => (Date.now() - started) / 1000;
      const done = (reason: DoneReason, steps: number, rows: number, duplicates = 0, drifts = 0): DoneEvent => {
        const secs = elapsed();
        const event: DoneEvent = { event: "done", reason, steps, rows_total: rows, elapsed_secs: secs, rows_per_sec: secs > 0 ? rows / secs : 0, duplicates, drifts };
        onEvent(event);
        return event;
      };
      const emit = (event: RunEvent) => { if (!stopped) onEvent(event); };
      const lake = flags["data-sink"] !== "postgres";
      const flushEvery = lake ? num(flags, "flush-interval", 10) : 0;

      const batch = async (): Promise<DoneEvent> => {
        const size = num(flags, "batch-size", 100_000);
        const min = num(flags, "batch-size-min", 0);
        const max = num(flags, "batch-size-max", 0);
        const batches = num(flags, "num-batches", 10);
        let rows = 0;
        let n = 0;
        while (batches === 0 || n < batches) {
          await pause(batchPace(size));
          if (stopped) return done("interrupted", n, rows);
          n++;
          const these = min > 0 || max > 0 ? Math.round(min + random() * (max - min)) : size;
          // About 150k-250k rows a second, like a laptop writing to a local catalog.
          const secs = these / (150_000 + random() * 100_000);
          rows += these;
          if (flushEvery > 0 && n % flushEvery === 0) emit({ event: "flush", batch: n, secs: 0.05 + random() * 0.2 });
          emit({
            event: "batch", batch: n, num_batches: batches, rows: these, batch_secs: secs, rows_total: rows,
            elapsed_secs: elapsed(), rows_per_sec: these / secs, ...(lake ? { table_rows: rows } : {}),
          });
        }
        return done("complete", n, rows);
      };

      const ticker = async (): Promise<DoneEvent> => {
        const interval = num(flags, "tick-interval", 1);
        const duration = num(flags, "duration", 60);
        const dupRate = num(flags, "duplicate-rate", 0);
        const driftRate = num(flags, "schema-drift-rate", 0);
        const table = { simple: "events", rich: "events_rich", rich_ml: "events_rich_ml" }[str(flags, "mode", "simple")] ?? "events";
        const ticks = Math.floor(duration / interval);
        let rows = 0, duplicates = 0, drifts = 0, n = 0;
        while (n < ticks) {
          await pause(interval * tickScale);
          if (stopped) return done("interrupted", n, rows, duplicates, drifts);
          n++;
          rows++;
          const duplicate = dupRate > 0 && random() < dupRate;
          if (duplicate) { duplicates++; rows++; }
          const drift = driftRate > 0 && random() < driftRate;
          if (drift) {
            drifts++;
            emit({ event: "drift", tick: n, id: n, error: `Binder Error: Table "${table}" does not have a column with name "event_category"` });
          }
          const secs = n * interval;
          emit({
            event: "tick", tick: n, rows: duplicate ? 2 : 1, duplicate, drift, rows_total: rows, duplicates, drifts,
            elapsed_secs: secs, rows_per_sec: rows / secs, ...(lake ? { table_rows: rows } : {}),
          });
        }
        if (flushEvery > 0 && rows > flushEvery) emit({ event: "flush", rows, secs: 0.04 });
        return done("duration", n, rows, duplicates, drifts);
      };

      const finished = flags["run-mode"] === "ticker" ? ticker() : batch();
      return {
        done: finished,
        stop: async () => {
          stopped = true;
          wake();
        },
      };
    },

    secrets: {
      types: FAKE_SECRET_TYPES,
      list: async () => secrets.slice(),
      create: async (request: SecretRequest) => {
        // The values stop here: the fake keeps the name and type, as DuckDB's list would show.
        secrets = [...secrets.filter((s) => s.name !== request.name), { name: request.name, type: request.secret_type, provider: "config", scope: request.scope ? [request.scope] : [] }];
        return secrets.slice();
      },
      drop: async (name: string) => {
        secrets = secrets.filter((s) => s.name !== name);
        return secrets.slice();
      },
    },
  };
}
