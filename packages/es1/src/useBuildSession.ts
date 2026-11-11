// What the BUILD panel holds while it's open: the controls, each connector's form and what
// DISCOVER found. Secrets live here, in memory only, until DISCOVER encrypts them. Nothing here
// is saved to disk.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DESTINATIONS, INITIAL_BUILD, EXAMPLE_TABLES, SOURCES, pressed, sourceName, validName, dataPlaneName, type BuildState, type Press } from "./buildSpec";
import { EngineError, type Discovering, type Engine } from "./engine";
import { buildConfig, initialValues, parseFields, problems, requiredProgress, secretPaths, withoutSecrets, type Field, type Values } from "./schemaForm";

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

export function useBuildSession(engine: Engine | null, profile: string, prefix: string) {
  const [state, setState] = useState<BuildState>(INITIAL_BUILD);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [rehearsal, setRehearsal] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<Record<string, Schema>>({});
  const [configs, setConfigs] = useState<Record<string, Values>>({});
  const [drawer, setDrawer] = useState<{ side: Side; note?: string; loadError?: string } | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const running = useRef<Discovering | null>(null);
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
    setState((s) => (s.found ? { ...s, found: false, bindings: EXAMPLE_TABLES.map((b) => ({ ...b })) } : s));
  }, [engine, profile]);

  const valuesFor = useCallback((image: string, fields: Field[]) => configs[image] ?? initialValues(fields), [configs]);

  const move = useCallback((patch: Partial<BuildState>, change: Moved) => {
    setState((s) => {
      const next = { ...s, ...patch };
      // What was found belongs to this source, on this plane.
      const stale = s.found && (next.source !== s.source || next.sourceName !== s.sourceName || next.dataPlane !== s.dataPlane);
      return stale ? { ...next, found: false, bindings: EXAMPLE_TABLES.map((b) => ({ ...b })) } : next;
    });
    setMoved(change);
    setRehearsal(null);
  }, []);

  const press = useCallback((button: Press) => setRehearsal(pressed(button, state, prefix, profile)), [state, prefix, profile]);

  const openConfig = useCallback((side: Side, note?: string) => {
    setDrawer({ side, note });
    loadSchema(imageOf(side, state).image).catch((e) => setDrawer((d) => (d ? { ...d, loadError: message(e) } : d)));
  }, [imageOf, loadSchema, state]);

  const closeConfig = useCallback(() => setDrawer(null), []);

  const saveConfig = useCallback((values: Values) => {
    if (!drawer) return;
    const { image } = imageOf(drawer.side, state);
    setConfigs((all) => ({ ...all, [image]: values }));
    setDrawer(null);
    if (drawer.side === "source") {
      // New settings mean what was found no longer stands.
      setState((s) => (s.found ? { ...s, found: false, bindings: EXAMPLE_TABLES.map((b) => ({ ...b })) } : s));
    }
    setMoved({ field: `${image} config`, value: "saved" });
    setRehearsal(null);
  }, [drawer, imageOf, state]);

  const discover = useCallback(async () => {
    if (running.current) {
      await running.current.stop().catch(() => {});
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
    const job = engine.discover({
      name,
      image: `ghcr.io/estuary/${source.image}${schema.tag}`,
      config: buildConfig(schema.fields, values),
      secret_paths: secretPaths(schema.fields, values),
    }, dataPlaneName(state), profile);
    running.current = job;
    setDiscovering(true);
    try {
      const found = await job.done;
      const lead = `${name}/`;
      setState((s) => ({
        ...s,
        found: true,
        bindings: found.bindings.map((b) => ({
          table: b.target.startsWith(lead) ? b.target.slice(lead.length) : b.target,
          target: b.target,
          resource: b.resource,
          on: true,
        })),
      }));
      // Estuary has encrypted them, so the plain text has nothing left to do.
      setConfigs((all) => ({ ...all, [source.image]: withoutSecrets(schema.fields, values) }));
      setMoved({ field: "DISCOVER", value: `${found.bindings.length} found` });
    } catch (e) {
      if (!(e instanceof EngineError && e.code === "stopped")) {
        setDrawer({ side: "source", note: message(e) });
      }
    } finally {
      running.current = null;
      setDiscovering(false);
    }
  }, [engine, loadSchema, prefix, profile, state, valuesFor]);

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

  return { state, moved, rehearsal, move, press, openConfig, closeConfig, saveConfig, discover, discovering, configStatus, drawer: openDrawer };
}
