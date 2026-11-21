// What `parkbench run --output jsonl` writes: one event per line. These mirror the structs in
// parkbench's events.go; its README lists every field. PB-1's sequencer is driven by them,
// whether they come from Parkbench or from the fake engine.

export interface BatchEvent {
  event: "batch";
  batch: number;
  /** 0 = run forever. */
  num_batches: number;
  rows: number;
  batch_secs: number;
  rows_total: number;
  elapsed_secs: number;
  rows_per_sec: number;
  /** COUNT(*) after the batch; DuckLake only. */
  table_rows?: number;
}

export interface TickEvent {
  event: "tick";
  tick: number;
  /** 1, or 2 with a duplicate. */
  rows: number;
  duplicate: boolean;
  drift: boolean;
  rows_total: number;
  duplicates: number;
  drifts: number;
  elapsed_secs: number;
  rows_per_sec: number;
  table_rows?: number;
}

/** A schema-drift insert was rejected. It comes before its tick's `tick` event. */
export interface DriftEvent {
  event: "drift";
  tick: number;
  id: number;
  error: string;
}

/** Inlined rows flushed to Parquet: after `batch` in batch mode, or once at the end of a stream. */
export interface FlushEvent {
  event: "flush";
  batch?: number;
  rows?: number;
  secs: number;
}

export type DoneReason = "complete" | "duration" | "interrupted";

/** Always the last event of a run that didn't fail. */
export interface DoneEvent {
  event: "done";
  reason: DoneReason;
  /** Batches or ticks completed. */
  steps: number;
  rows_total: number;
  elapsed_secs: number;
  rows_per_sec: number;
  duplicates: number;
  drifts: number;
}

export type RunEvent = BatchEvent | TickEvent | DriftEvent | FlushEvent | DoneEvent;
