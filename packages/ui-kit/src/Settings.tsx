// SETTINGS (the gear in the header bar): the appearance (theme, displays), the Anthropic
// API key, the traces database, and, when the host's engine can manage them, the traces
// server and resetting the traces. Host-level and shared: DH-1, EH-1, and the rack use the
// same key and traces. The host passes its engine's status and restart, and `traces` if
// its engine is the one that runs the traces server (DH-1's agent does; EH-1's grader
// only reads).
//
// The key and the traces path apply when the engine starts, so changing either restarts
// it (runs in progress stop). Storage is on the Rust side (src-tauri/src/settings.rs).

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import type { Appearance } from "./appearance";
import { AppearanceControls } from "./HostBar";
import { Menu } from "./Menu";

/** Where traces go, and whether the background traces server is up (DH-1's agent reports it). */
export interface TracesInfo {
  enabled: boolean;
  db: string | null;
  exists: boolean;
  size_bytes: number | null;
  server: { running: boolean; uri: string | null; pid: number | null } | null;
}

/** What the host's engine can do with the traces. */
export interface TracesControls {
  info: () => Promise<TracesInfo>;
  stop: () => Promise<unknown>;
  reset: () => Promise<unknown>;
}

export interface SettingsEngine {
  status: "connecting" | "ready" | "down";
  restart: () => Promise<void>;
}

interface SettingsView {
  apiKeySource: "keychain" | "environment" | "env-file" | "none";
  apiKeyHint: string | null;
  tracesDb: string | null;
  defaultTracesDb: string;
  /** The traces file every engine is given, resolved. */
  tracesPath: string;
  agentDir: string;
  /** How each of this host's engines was started (crates/dh-host, discovery.rs). */
  engines: StartedEngine[];
  enginesFile: string | null;
  enginesFileProblem: string | null;
}

interface StartedEngine {
  engine: string;
  source: "override" | "file" | "checkout";
  command: string;
  version: string | null;
}

const ENGINE_NAMES: Record<string, string> = { dh1: "DH-1 · agent", eh1: "EH-1 · grader" };

const ENGINE_SOURCE: Record<StartedEngine["source"], string> = {
  override: "dev override",
  file: "engines.json",
  checkout: "checkout",
};

const KEY_SOURCE: Record<SettingsView["apiKeySource"], string> = {
  keychain: "Saved in the Keychain",
  environment: "From the environment (ANTHROPIC_API_KEY)",
  "env-file": "From the agent folder's .env file",
  none: "Not set: runs will fail until you add one",
};

function size(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Props {
  engine: SettingsEngine;
  /** Left out when the engine doesn't manage the traces server. */
  traces?: TracesControls;
  appearance: Appearance;
  onAppearance: (appearance: Appearance) => void;
}

export function SettingsMenu({ engine, traces: tracesControls, appearance, onAppearance }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<SettingsView | null>(null);
  const [traces, setTraces] = useState<TracesInfo | null>(null);
  const [key, setKey] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setConfirmReset(false);
    setKey("");
  }, []);

  const refresh = useCallback(async () => {
    setView(await invoke<SettingsView>("settings_get"));
    if (tracesControls && engine.status === "ready") {
      setTraces(await tracesControls.info().catch(() => null));
    } else {
      setTraces(null);
    }
  }, [tracesControls, engine.status]);

  useEffect(() => {
    if (open) void refresh().catch((e) => setNote({ text: message(e), error: true }));
  }, [open, refresh]);

  /** Do something, show what happened, and refresh. `restart`: the engine picks it up at start. */
  const act = async (label: string, work: () => Promise<string | void>, restart = false) => {
    setWorking(label);
    setNote(null);
    try {
      const done = await work();
      if (restart) await engine.restart();
      if (done) setNote({ text: done });
    } catch (e) {
      setNote({ text: message(e), error: true });
    } finally {
      setWorking(null);
      void refresh().catch(() => {});
    }
  };

  const tracesPath = traces?.db ?? view?.tracesPath ?? view?.tracesDb ?? view?.defaultTracesDb ?? "";
  const server = traces?.server;
  const ready = engine.status === "ready";

  return (
    <Menu
      open={open}
      onClose={close}
      label="Settings"
      align="right"
      anchor={
        <button className="bar-button settings-button" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))} title="Settings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
          <span className="settings-button-label">SETTINGS</span>
        </button>
      }
    >
      <div className="settings">
        <section>
          <AppearanceControls appearance={appearance} onChange={onAppearance} />
        </section>

        <section>
          <label className="settings-label" htmlFor="api-key">ANTHROPIC API KEY</label>
          <p className={`settings-status${view?.apiKeySource === "none" ? " warn" : ""}`}>
            {view ? `${KEY_SOURCE[view.apiKeySource]}${view.apiKeyHint ? ` (${view.apiKeyHint})` : ""}` : "…"}
          </p>
          <form
            className="settings-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) void act("key", async () => {
                await invoke("api_key_set", { key });
                setKey("");
                return "Saved in the Keychain. The engine restarted with it.";
              }, true);
            }}
          >
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={view?.apiKeySource === "keychain" ? "Replace the key…" : "sk-ant-…"}
              value={key}
              onChange={(e) => setKey(e.currentTarget.value)}
            />
            <button className="pane-button" type="submit" disabled={!key.trim() || working !== null}>Save</button>
          </form>
          <p className="settings-hint">
            Stored in the macOS Keychain and used before the agent folder's .env.
            {view?.apiKeySource === "keychain" && (
              <>
                {" "}
                <button className="link-button" disabled={working !== null}
                  onClick={() => void act("key", async () => {
                    await invoke("api_key_clear");
                    return "Removed from the Keychain.";
                  }, true)}>
                  Remove it
                </button>
              </>
            )}
          </p>
        </section>

        <section>
          <span className="settings-label">TRACES DATABASE</span>
          <p className="settings-path selectable" title={tracesPath}>{tracesPath}</p>
          <p className="settings-hint">
            {traces ? (traces.exists ? `${size(traces.size_bytes)} · every run is recorded here` : "Not created yet: the first run creates it") : "Every run is recorded here"}
            {!view?.tracesDb && " · the default, in the agent folder"}
          </p>
          <div className="settings-row">
            <button className="pane-button" disabled={working !== null}
              onClick={() => void act("traces", async () => {
                const path = await save({
                  title: "Traces database",
                  defaultPath: view?.tracesDb ?? "agent_traces.duckdb",
                  filters: [{ name: "DuckDB", extensions: ["duckdb"] }],
                });
                if (!path) return;
                await invoke("traces_db_set", { path });
                await engine.restart();
                return "Traces go to the new file now.";
              })}>
              Choose…
            </button>
            {view?.tracesDb && (
              <button className="pane-button" disabled={working !== null}
                onClick={() => void act("traces", async () => {
                  await invoke("traces_db_set", { path: null });
                  return "Back to the default traces file.";
                }, true)}>
                Use the default
              </button>
            )}
          </div>
        </section>

        {tracesControls && <section>
          <span className="settings-label">TRACES SERVER</span>
          <div className="settings-row spread">
            <span className="settings-server">
              <span className={`dot${server?.running ? " on" : ""}`} aria-hidden="true" />
              {!ready ? "Engine offline" : server?.running ? `Quack ${server.uri?.replace(/^quack:/, "") ?? ""}` : "Not running · starts with the next run"}
            </span>
            {server?.running && (
              <button className="pane-button" disabled={working !== null}
                onClick={() => void act("server", async () => {
                  await tracesControls!.stop();
                  return "Traces server stopped.";
                })}>
                Stop
              </button>
            )}
          </div>
          <p className="settings-hint">Lets other programs read the traces while runs write them.</p>
        </section>}

        {view && view.engines.length > 0 && <section>
          <span className="settings-label">{view.engines.length > 1 ? "ENGINES" : "ENGINE"}</span>
          {view.engines.map((e) => (
            <div key={e.engine} className="settings-engine">
              <span className="settings-row spread">
                <span className="settings-engine-name">{ENGINE_NAMES[e.engine] ?? e.engine}</span>
                <span className="settings-hint">{ENGINE_SOURCE[e.source]}{e.version ? ` · ${e.version}` : ""}</span>
              </span>
              <p className="settings-path selectable" title={e.command}>{e.command}</p>
            </div>
          ))}
          {view.enginesFileProblem && <p className="settings-hint warn">{view.enginesFileProblem}</p>}
        </section>}

        <section className="settings-actions">
          <button className="pane-button wide" disabled={working !== null}
            onClick={() => void act("shell", async () => {
              await invoke("traces_shell_open");
              return "Opened Terminal with the duckdb CLI.";
            })}>
            Open traces in DuckDB shell
          </button>
          {tracesControls && (!confirmReset ? (
            <button className="pane-button wide danger" disabled={!ready || !traces?.exists || working !== null} onClick={() => setConfirmReset(true)}>
              Reset traces…
            </button>
          ) : (
            <div className="settings-confirm">
              <span>Delete every recorded run in this file? This can't be undone.</span>
              <div className="settings-row">
                <button className="pane-button" onClick={() => setConfirmReset(false)}>Cancel</button>
                <button className="pane-button danger" disabled={working !== null}
                  onClick={() => void act("reset", async () => {
                    await tracesControls!.reset();
                    setConfirmReset(false);
                    return "Traces deleted. The next run starts a fresh file.";
                  })}>
                  Delete traces
                </button>
              </div>
            </div>
          ))}
        </section>

        {(working || note) && (
          <p className={`settings-note${note?.error ? " error" : ""}`} aria-live="polite">
            {working ? "Working…" : note?.text}
          </p>
        )}
        <p className="settings-hint">Changing the key or the traces file restarts the engine: runs in progress stop.</p>
      </div>
    </Menu>
  );
}
