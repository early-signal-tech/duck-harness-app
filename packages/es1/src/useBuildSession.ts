// What the BUILD panel holds while it's open: the controls, each connector's form, what DISCOVER
// found and ES-1's draft. Secrets are held here, in memory only, until the app closes, so that
// DISCOVER and DRAFT can run again without retyping them. They're never saved to disk here, and
// only reach flowctl inside the engine's private folder. Only the draft's ID is saved, so a draft
// left on Estuary can be discarded.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DESTINATIONS, INITIAL_BUILD, EXAMPLE_TABLES, SOURCES, dataPlaneName, destinationName, draftCatalog, pressed, sourceName, validName,
  type BuildState, type DraftStage, type Press,
} from "./buildSpec";
import { EngineError, type Engine, type Running } from "./engine";
import { buildConfig, initialValues, parseFields, problems, requiredProgress, secretPaths, type Field, type Values } from "./schemaForm";

export interface Moved {
  field: string;
  value: string;
}

export type Side = "source" | "destination";

interface Schema {
  /** With its colon: ":v3". */
  tag: string;
  fields: Field[];
}

interface SchemaRow {
  image_tag: string;
  endpoint_spec_schema: Record<string, unknown>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const stopped = (e: unknown) => e instanceof EngineError && e.code === "stopped";

export interface Draft {
  id: string;
  stage: Exclude<DraftStage, "none">;
}

export type Busy = "discover" | "draft" | "test" | "discard";

/** Why a step failed, shown in full. */
export interface Failure {
  title: string;
  text: string;
}

const draftKey = (profile: string) => `es1.draft.${profile}`;

/** A draft from an earlier session: its contents aren't known, so it counts as edited. */
function loadDraft(profile: string): Draft | null {
  try {
    const id = localStorage.getItem(draftKey(profile));
    return id ? { id, stage: "edited" } : null;
  } catch {
    return null;
  }
}

function saveDraftId(profile: string, id: string | null): void {
  try {
    if (id) localStorage.setItem(draftKey(profile), id);
    else localStorage.removeItem(draftKey(profile));
  } catch {
    // Not remembered: a draft left behind can still be deleted on Estuary's dashboard.
  }
}

export function useBuildSession(engine: Engine | null, profile: string, prefix: string) {
  const [state, setState] = useState<BuildState>(INITIAL_BUILD);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [rehearsal, setRehearsal] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<Record<string, Schema>>({});
  const [configs, setConfigs] = useState<Record<string, Values>>({});
  const [drawer, setDrawer] = useState<{ side: Side; note?: string; loadError?: string } | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const running = useRef<Running<unknown> | null>(null);
  const [found, setFound] = useState<Record<string, any> | null>(null);
  const [draft, setDraft] = useState<Draft | null>(() => loadDraft(profile));
  const [failure, setFailure] = useState<Failure | null>(null);
  const loading = useRef<Map<string, Promise<Schema>>>(new Map());

  const imageOf = useCallback((side: Side, s: BuildState) => (side === "source" ? SOURCES[s.source] : DESTINATIONS[s.destination]), []);

  const loadSchema = useCallback((image: string): Promise<Schema> => {
    const known = loading.current.get(image);
    if (known) return known;
    if (!engine) return Promise.reject(new EngineError("the flowctl bridge is not running"));
    const load = engine.once<SchemaRow>("connector_schema", { image }, profile).then((result) => {
      const row = result.rows[0];
      if (!row) throw new EngineError(`Estuary's registry has no ${image}.`);
      const schema = { tag: row.image_tag, fields: parseFields(row.endpoint_spec_schema) };
      setSchemas((all) => ({ ...all, [image]: schema }));
      return schema;
    });
    loading.current.set(image, load);
    load.catch(() => loading.current.delete(image)); // A failure can be tried again.
    return load;
  }, [engine, profile]);

  // A different login or engine can see different schemas, and secrets don't carry across profiles.
  useEffect(() => {
    loading.current.clear();
    setSchemas({});
    setConfigs({});
    setFound(null);
    setState((s) => (s.found ? { ...s, found: false, bindings: EXAMPLE_TABLES.map((b) => ({ ...b })) } : s));
  }, [engine, profile]);

  // A draft belongs to its profile.
  useEffect(() => setDraft(loadDraft(profile)), [profile]);

  /** The draft no longer matches the panel. */
  const edited = useCallback(() => setDraft((d) => (d && d.stage !== "edited" ? { ...d, stage: "edited" } : d)), []);

  const valuesFor = useCallback((image: string, fields: Field[]) => configs[image] ?? initialValues(fields), [configs]);

  const move = useCallback((patch: Partial<BuildState>, change: Moved) => {
    setState((s) => {
      const next = { ...s, ...patch };
      // What was found belongs to this source, on this plane.
      const stale = s.found && (next.source !== s.source || next.sourceName !== s.sourceName || next.dataPlane !== s.dataPlane);
      if (stale) setFound(null);
      return stale ? { ...next, found: false, bindings: EXAMPLE_TABLES.map((b) => ({ ...b })) } : next;
    });
    if (!("armed" in patch)) edited();
    setMoved(change);
    setRehearsal(null);
  }, [edited]);

  const press = useCallback((button: Press) => setRehearsal(pressed(button, state, prefix, profile)), [state, prefix, profile]);

  const openConfig = useCallback((side: Side, note?: string) => {
    setDrawer({ side, note });
    loadSchema(imageOf(side, state).image).catch((e) => setDrawer((d) => (d ? { ...d, loadError: message(e) } : d)));
  }, [imageOf, loadSchema, state]);

  const closeConfig = useCallback(() => setDrawer(null), []);

  const saveConfig = useCallback((values: Values) => {
    if (!drawer) return;
    const { image } = imageOf(drawer.side, state);
    const schema = schemas[image];
    const before = schema ? valuesFor(image, schema.fields) : configs[image];
    setDrawer(null);
    setRehearsal(null);
    // Saving what was already there changes nothing, so what was found and drafted still stands.
    if (JSON.stringify(values) === JSON.stringify(before)) {
      setConfigs((all) => ({ ...all, [image]: values }));
      setMoved({ field: `${image} config`, value: "unchanged" });
      return;
    }
    setConfigs((all) => ({ ...all, [image]: values }));
    if (drawer.side === "source") {
      // New settings mean what was found no longer stands.
      setFound(null);
      setState((s) => (s.found ? { ...s, found: false, bindings: EXAMPLE_TABLES.map((b) => ({ ...b })) } : s));
    }
    edited();
    setMoved({ field: `${image} config`, value: "saved" });
  }, [configs, drawer, edited, imageOf, schemas, state, valuesFor]);

  const discover = useCallback(async () => {
    if (running.current) {
      if (busy === "discover") await running.current.stop().catch(() => {});
      return;
    }
    if (!engine) return;
    setRehearsal(null);
    const source = SOURCES[state.source];
    const name = sourceName(state, prefix);
    if (!validName(name)) {
      setMoved({ field: "capture name", value: "has to look like prefix/name" });
      return;
    }
    let schema: Schema;
    try {
      schema = await loadSchema(source.image);
    } catch (e) {
      setDrawer({ side: "source", loadError: message(e) });
      return;
    }
    const values = valuesFor(source.image, schema.fields);
    const missing = problems(schema.fields, values);
    if (missing.length) {
      setDrawer({ side: "source", note: `DISCOVER needs: ${missing.join(", ")}.` });
      return;
    }
    const discovering = engine.discover({
      name,
      image: `ghcr.io/estuary/${source.image}${schema.tag}`,
      config: buildConfig(schema.fields, values),
      secret_paths: secretPaths(schema.fields, values),
    }, dataPlaneName(state), profile);
    running.current = discovering;
    setBusy("discover");
    try {
      const result = await discovering.done;
      const found = result;
      // Estuary names a found collection under the capture, or under the prefix: show the rest.
      const short = (target: string) => {
        for (const lead of [`${name}/`, prefix]) if (lead && target.startsWith(lead)) return target.slice(lead.length);
        return target;
      };
      setState((s) => ({
        ...s,
        found: true,
        bindings: found.bindings.map((b) => ({
          table: short(b.target),
          target: b.target,
          resource: b.resource,
          on: true,
        })),
      }));
      setFound(result.catalog);
      // Kept, so DISCOVER can run again; the catalog has them encrypted.
      setConfigs((all) => ({ ...all, [source.image]: values }));
      edited();
      setMoved({ field: "DISCOVER", value: `${found.bindings.length} found` });
    } catch (e) {
      if (!stopped(e)) setDrawer({ side: "source", note: message(e) });
    } finally {
      running.current = null;
      setBusy(null);
    }
  }, [busy, edited, engine, loadSchema, prefix, profile, state, valuesFor]);

  /** Run one step at a time. Pressing the running step's button again stops it. */
  const step = useCallback(async <T,>(which: Busy, start: () => Running<T>, onDone: (result: T) => void, failed: string) => {
    if (running.current) {
      if (busy === which) await running.current.stop().catch(() => {});
      return;
    }
    setRehearsal(null);
    setFailure(null);
    const job = start();
    running.current = job as Running<unknown>;
    setBusy(which);
    try {
      onDone(await job.done);
    } catch (e) {
      if (!stopped(e)) setFailure({ title: failed, text: message(e) });
      if (e instanceof EngineError && e.code === "no_draft") {
        setDraft(null);
        saveDraftId(profile, null);
      } else if (which === "test" && !stopped(e)) {
        setDraft((d) => (d ? { ...d, stage: "failed" } : d));
      }
    } finally {
      running.current = null;
      setBusy(null);
    }
  }, [busy, profile]);

  const draftNow = useCallback(async () => {
    if (running.current) {
      if (busy === "draft") await running.current.stop().catch(() => {});
      return;
    }
    if (!engine) return;
    if (!state.found || !found) {
      setMoved({ field: "DRAFT", value: "press DISCOVER first" });
      return;
    }
    if (!found.captures?.[sourceName(state, prefix)]) {
      setMoved({ field: "DRAFT", value: "what DISCOVER found doesn't match this source: press DISCOVER again" });
      return;
    }
    const destination = DESTINATIONS[state.destination];
    const name = destinationName(state, prefix);
    if (!validName(name)) {
      setMoved({ field: "materialization name", value: "has to look like prefix/name" });
      return;
    }
    let schema: Schema;
    try {
      schema = await loadSchema(destination.image);
    } catch (e) {
      setDrawer({ side: "destination", loadError: message(e) });
      return;
    }
    const values = valuesFor(destination.image, schema.fields);
    const missing = problems(schema.fields, values);
    if (missing.length) {
      setDrawer({ side: "destination", note: `DRAFT needs: ${missing.join(", ")}.` });
      return;
    }
    const catalog = draftCatalog(state, prefix, found, buildConfig(schema.fields, values), schema.tag);
    const secrets = secretPaths(schema.fields, values).map((path) => ["materializations", name, "endpoint", "connector", "config", ...path.split(".")]);
    await step("draft", () => engine.draftAuthor(catalog, secrets, draft?.id ?? null, profile), (result) => {
      setDraft({ id: result.draft_id, stage: "drafted" });
      saveDraftId(profile, result.draft_id);
      setMoved({ field: "DRAFT", value: `${result.specs.length} specs on Estuary` });
    }, "DRAFT FAILED");
  }, [busy, draft, engine, found, loadSchema, prefix, profile, state, step, valuesFor]);

  const testNow = useCallback(async () => {
    if (running.current) {
      if (busy === "test") await running.current.stop().catch(() => {});
      return;
    }
    if (!engine) return;
    if (!draft) {
      setMoved({ field: "TEST", value: "press DRAFT first" });
      return;
    }
    if (draft.stage === "edited") {
      setMoved({ field: "TEST", value: "the panel changed since DRAFT: press DRAFT again" });
      return;
    }
    const id = draft.id;
    await step("test", () => engine.draftTest(id, dataPlaneName(state), profile), () => {
      setDraft((d) => (d && d.id === id ? { ...d, stage: "tested" } : d));
      setMoved({ field: "TEST", value: "passed" });
    }, "TEST FAILED");
  }, [busy, draft, engine, profile, state, step]);

  const discardNow = useCallback(async () => {
    if (running.current) return;
    if (!engine) return;
    if (!draft) {
      setMoved({ field: "DISCARD", value: "no draft to discard" });
      return;
    }
    const id = draft.id;
    await step("discard", () => engine.draftDelete(id, profile), () => {
      setDraft(null);
      saveDraftId(profile, null);
      setMoved({ field: "DISCARD", value: "draft deleted" });
    }, "DISCARD FAILED");
  }, [draft, engine, profile, step]);

  /** The line under a CONFIG button. */
  const configStatus = useCallback((side: Side) => {
    const connector = imageOf(side, state);
    const schema = schemas[connector.image];
    if (side === "source" && state.found) return "encrypted · found";
    if (!schema || !configs[connector.image]) return `${connector.required.length} required · secrets`;
    const { filled, total } = requiredProgress(schema.fields, configs[connector.image]);
    return filled === total ? "all set · held in memory" : `${filled} of ${total} required`;
  }, [configs, imageOf, schemas, state]);

  const openDrawer = useMemo(() => {
    if (!drawer) return null;
    const connector = imageOf(drawer.side, state);
    const schema = schemas[connector.image];
    return {
      side: drawer.side,
      connector: `${connector.image} ${schema?.tag ?? `:${connector.tag}`}`,
      fields: schema?.fields ?? null,
      values: schema ? valuesFor(connector.image, schema.fields) : {},
      note: drawer.note,
      loadError: drawer.loadError,
    };
  }, [drawer, imageOf, schemas, state, valuesFor]);

  return {
    state, moved, rehearsal, move, press, openConfig, closeConfig, saveConfig, configStatus, drawer: openDrawer,
    discover, draftNow, testNow, discardNow, busy, discovering: busy === "discover",
    draftStage: (draft?.stage ?? "none") as DraftStage, failure, closeFailure: () => setFailure(null),
  };
}
