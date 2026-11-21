//! The engines: each device's server, run as a child process speaking JSON Lines.
//! A host runs one engine (a standalone app) or several (the rack), each by its name.
//!
//! UI -> engine: `engine_send(engine, line)` writes one request line to its stdin. A request
//! that changes something outside the app (an engine's `writes`, such as publishing an Estuary
//! spec) is refused there: it goes through `engine_send_confirmed`, which asks the person in a
//! native dialog first. The face can't skip that (DEVICE_SPEC §10).
//! Engine -> UI: each stdout line is an `engine-message` event, `{engine, line}` (the raw
//! JSON string; the TypeScript client parses it). stderr (the engine's logs) goes to this
//! process's stderr, prefixed with the engine's name. When an engine exits, an
//! `engine-exit` event carries `{engine, generation}`; the generation goes up on every
//! start, so a client connected to a restarted engine can ignore the old one's exit.
//!
//! Settings (settings.rs) apply at start: the Keychain API key becomes ANTHROPIC_API_KEY,
//! and the engines that use traces get the same file as an absolute --traces-db. ES-1's
//! bridge uses neither: it only runs flowctl, which keeps its own login.
//!
//! How each engine is found (a dev override, engines.json, or a checkout next to this
//! repo) is discovery.rs.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::discovery::{self, Found, Source};
use crate::settings;

/// The engines a host can run, named after the device each one serves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Engine {
    /// DH-1's engine: the agent server (duck-harness-serve, in duckdb-analytics-agent).
    Dh1,
    /// EH-1's engine: the grader (eh1-serve, in eh1-grader).
    Eh1,
    /// ES-1's engine: the flowctl bridge (es1-serve, in cli-bridge).
    Es1,
    /// PB-1's engine: the Parkbench bridge (pb1-serve, in cli-bridge).
    Pb1,
}

impl Engine {
    /// The name the web side uses for it.
    pub fn name(self) -> &'static str {
        match self {
            Engine::Dh1 => "dh1",
            Engine::Eh1 => "eh1",
            Engine::Es1 => "es1",
            Engine::Pb1 => "pb1",
        }
    }

    /// What it's called in errors and log prefixes.
    fn label(self) -> &'static str {
        match self {
            Engine::Dh1 => "agent server",
            Engine::Eh1 => "grader",
            Engine::Es1 => "flowctl bridge",
            Engine::Pb1 => "Parkbench bridge",
        }
    }

    /// Its repo, checked out next to this one in development.
    pub(crate) fn repo(self) -> &'static str {
        match self {
            Engine::Dh1 => "duckdb-analytics-agent",
            Engine::Eh1 => "eh1-grader",
            Engine::Es1 | Engine::Pb1 => "cli-bridge",
        }
    }

    /// The script a checkout runs.
    pub(crate) fn script(self) -> &'static str {
        match self {
            Engine::Dh1 => "duck-harness-serve",
            Engine::Eh1 => "eh1-serve",
            Engine::Es1 => "es1-serve",
            Engine::Pb1 => "pb1-serve",
        }
    }

    /// The dev override: a checkout to run instead.
    pub(crate) fn override_var(self) -> &'static str {
        match self {
            Engine::Dh1 => "DH1_AGENT_DIR",
            Engine::Eh1 => "EH1_GRADER_DIR",
            Engine::Es1 => "ES1_BRIDGE_DIR",
            Engine::Pb1 => "PB1_BRIDGE_DIR",
        }
    }

    /// Requests that change something outside the app. Each one is confirmed by the host.
    pub(crate) fn writes(self) -> &'static [&'static str] {
        match self {
            Engine::Es1 => &["draft_publish"],
            // Reset drops (or deletes) a catalog; the secrets live in DuckDB's store on this Mac.
            Engine::Pb1 => &["reset", "secrets_create", "secrets_drop"],
            Engine::Dh1 | Engine::Eh1 => &[],
        }
    }

    fn log_prefix(self) -> &'static str {
        match self {
            Engine::Dh1 => "[agent]",
            Engine::Eh1 => "[grader]",
            Engine::Es1 => "[es1]",
            Engine::Pb1 => "[pb1]",
        }
    }

    /// The command that starts it, with the settings that apply at start.
    fn command(self, app: &AppHandle, found: &Found) -> Command {
        let mut command = Command::new(&found.program);
        command.args(&found.args);
        if self.uses_agent_settings() {
            command.arg("--traces-db").arg(traces_path(app));
        }
        // A checkout runs in its folder, so its .env (ANTHROPIC_API_KEY) is found. An
        // installed engine runs in the app data folder.
        let dir = found.checkout.clone().or_else(|| settings::base_dir(app).ok());
        if let Some(dir) = dir.filter(|d| d.is_dir()) {
            command.current_dir(dir);
        }
        if self.uses_agent_settings() {
            if let Some(key) = settings::api_key() {
                command.env("ANTHROPIC_API_KEY", key);
            }
        }
        command
    }

    /// Whether it's given the traces file and the Anthropic key. The bridges (ES-1's and
    /// PB-1's) aren't: they have no use for either, and a tool shouldn't inherit a key it
    /// doesn't need.
    fn uses_agent_settings(self) -> bool {
        !matches!(self, Engine::Es1 | Engine::Pb1)
    }
}

/// The traces file, as an absolute path: the setting if it's absolute, else in the agent
/// checkout (the default, agent_traces.duckdb, is there, as for the CLI). DH-1 writes it
/// and EH-1 reads it, so both engines get this same path.
pub(crate) fn traces_path(app: &AppHandle) -> PathBuf {
    let chosen = settings::load(app).traces_db.unwrap_or_else(|| settings::DEFAULT_TRACES_DB.into());
    let path = PathBuf::from(&chosen);
    if path.is_absolute() { path } else { discovery::agent_dir().join(path) }
}

/// The discovery file: its path, and what it lists (None: there isn't one).
fn discovery_file(app: &AppHandle) -> (Option<PathBuf>, Option<Result<discovery::Listed, String>>) {
    let path = settings::base_dir(app).ok().map(|d| d.join(discovery::FILE_NAME));
    let listed = path.as_deref().and_then(discovery::read_file);
    (path, listed)
}

/// How an engine was last started, for Settings.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub engine: &'static str,
    pub source: Source,
    pub command: String,
    pub version: Option<String>,
}

/// One engine's process. Created once per engine when the host starts; the process
/// itself comes and goes with start and stop.
struct Process {
    engine: Engine,
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    generation: AtomicU64,
    started: Mutex<Option<Started>>,
}

/// The host's engines, by name.
pub struct Engines(HashMap<&'static str, Process>);

impl Engines {
    pub fn new(engines: &[Engine]) -> Self {
        Engines(
            engines
                .iter()
                .map(|&engine| {
                    let process = Process {
                        engine,
                        stdin: Mutex::new(None),
                        child: Mutex::new(None),
                        generation: AtomicU64::new(0),
                        started: Mutex::new(None),
                    };
                    (engine.name(), process)
                })
                .collect(),
        )
    }

    fn get(&self, name: &str) -> Result<&Process, String> {
        self.0.get(name).ok_or_else(|| format!("this app has no engine named {name:?}"))
    }

    /// Start every engine. A failure is logged; that engine's light shows it's down.
    pub fn start_all(&self, app: &AppHandle) {
        for process in self.0.values() {
            if let Err(e) = start(app, process) {
                eprintln!("{e}");
            }
        }
    }

    /// How each engine was last started, in a stable order.
    pub fn started(&self) -> Vec<Started> {
        let mut all: Vec<Started> = self.0.values().filter_map(|p| p.started.lock().unwrap().clone()).collect();
        all.sort_by_key(|s| s.engine);
        all
    }

    pub fn stop_all(&self) {
        for process in self.0.values() {
            stop(process);
        }
    }
}

#[derive(Clone, Serialize)]
struct MessageEvent<'a> {
    engine: &'a str,
    line: String,
}

#[derive(Clone, Serialize)]
struct ExitEvent<'a> {
    engine: &'a str,
    generation: u64,
}

fn start(app: &AppHandle, process: &Process) -> Result<(), String> {
    let engine = process.engine;
    let (_, listed) = discovery_file(app);
    let found = discovery::find(engine, listed.as_ref().and_then(|l| l.as_ref().ok()));
    let description = found.describe();
    *process.started.lock().unwrap() = Some(Started {
        engine: engine.name(),
        source: found.source,
        command: description.clone(),
        version: found.version.clone(),
    });
    let mut command = engine.command(app, &found);
    let generation = process.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start the {} ({description}): {e}", engine.label()))?;

    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let handle = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => {
                    let _ = handle.emit("engine-message", MessageEvent { engine: engine.name(), line });
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let _ = handle.emit("engine-exit", ExitEvent { engine: engine.name(), generation });
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("{} {line}", engine.log_prefix());
        }
    });

    *process.stdin.lock().unwrap() = child.stdin.take();
    *process.child.lock().unwrap() = Some(child);
    Ok(())
}

/// Close the engine's stdin (end of input stops its work and it exits), then wait a few
/// seconds for it before killing it.
fn stop(process: &Process) {
    process.stdin.lock().unwrap().take();
    if let Some(mut child) = process.child.lock().unwrap().take() {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// What the person is asked before a request that writes: None if it doesn't write.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Confirmation {
    pub title: String,
    pub message: String,
    pub button: String,
}

/// Whether this request line needs the person's confirmation, and what to ask. A line that
/// can't be read is treated as needing it, so a malformed write can't slip through.
pub(crate) fn confirmation(engine: Engine, line: &str) -> Option<Confirmation> {
    let writes = engine.writes();
    if writes.is_empty() {
        return None;
    }
    let request: serde_json::Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return Some(Confirmation { title: "Send this request?".into(), message: "It couldn't be read.".into(), button: "Send".into() }),
    };
    let kind = request.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if !writes.contains(&kind) {
        return None;
    }
    Some(match engine {
        Engine::Pb1 => pb1_confirmation(kind, &request),
        _ => publish_confirmation(&request),
    })
}

/// PB-1's reset and secrets, each said from its own arguments. A secret's values are never in
/// the message.
fn pb1_confirmation(kind: &str, request: &serde_json::Value) -> Confirmation {
    let arg = |name: &str| request.pointer(&format!("/args/{name}")).and_then(|v| v.as_str());
    let name = arg("name").unwrap_or("?");
    match kind {
        "reset" => Confirmation {
            title: "Reset this catalog?".into(),
            message: match arg("ducklake_secret") {
                Some(secret) => format!(
                    "Drops events, events_rich and events_rejected in {secret}, then runs setup again. Parquet files already written stay."
                ),
                None => format!(
                    "Deletes the local {} catalog and its data folder, then runs setup again.",
                    if arg("metadata_store") == Some("duckdb") { "DuckDB" } else { "Postgres" }
                ),
            },
            button: "Reset".into(),
        },
        "secrets_create" => Confirmation {
            title: format!("Save the secret {name}?"),
            message: format!(
                "Saves a {} secret named {name} in DuckDB's secret store on this Mac, replacing one with the same name. Any DuckDB on this Mac can use it.",
                arg("type").unwrap_or("DuckDB")
            ),
            button: "Save".into(),
        },
        _ => Confirmation {
            title: format!("Delete the secret {name}?"),
            message: format!("Deletes {name} from DuckDB's secret store on this Mac. A catalog that uses it can't be reached until it's saved again."),
            button: "Delete".into(),
        },
    }
}

/// ES-1's publish: the specs it makes live.
fn publish_confirmation(request: &serde_json::Value) -> Confirmation {
    let names: Vec<&str> = request
        .pointer("/input/expect")
        .and_then(|e| e.as_array())
        .map(|list| list.iter().filter_map(|n| n.as_str()).collect())
        .unwrap_or_default();
    let profile = request.get("profile").and_then(|p| p.as_str()).unwrap_or("default");
    let plane = request.pointer("/args/data_plane").and_then(|p| p.as_str());
    let listed = names.iter().map(|n| format!("• {n}")).collect::<Vec<_>>().join("\n");
    let count = names.len();
    Confirmation {
        title: format!("Publish {count} spec{} to Estuary?", if count == 1 { "" } else { "s" }),
        message: format!(
            "This makes them live for profile {profile}{}:\n\n{listed}\n\nCapturing and writing data start as soon as it publishes. They can't be unpublished from ES-1.",
            plane.map(|p| format!(", on {p}")).unwrap_or_default(),
        ),
        button: "Publish".into(),
    }
}

/// Send one request to an engine. `line` is a JSON object; the newline is added here. A request
/// that writes is refused here: it has to go through `engine_send_confirmed`.
#[tauri::command]
pub fn engine_send(engine: String, line: String, engines: State<Engines>) -> Result<(), String> {
    let process = engines.get(&engine)?;
    if confirmation(process.engine, &line).is_some() {
        return Err("this request changes something outside the app, so it needs the person's confirmation".into());
    }
    write_line(process, &line)
}

/// Ask the person in a native dialog, then send. Cancelling sends nothing and returns an error
/// saying so. A request that doesn't write is sent without asking.
#[tauri::command]
pub async fn engine_send_confirmed(app: AppHandle, engine: String, line: String) -> Result<(), String> {
    let kind = app.state::<Engines>().get(&engine)?.engine;
    if let Some(ask) = confirmation(kind, &line) {
        let (tx, rx) = std::sync::mpsc::channel();
        app.dialog()
            .message(ask.message)
            .title(ask.title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(ask.button, "Cancel".into()))
            .show(move |ok| {
                let _ = tx.send(ok);
            });
        let confirmed = tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(false))
            .await
            .unwrap_or(false);
        if !confirmed {
            return Err("cancelled".into());
        }
    }
    let engines = app.state::<Engines>();
    write_line(engines.get(&engine)?, &line)
}

fn write_line(process: &Process, line: &str) -> Result<(), String> {
    if line.contains('\n') {
        return Err("a request must be a single line of JSON".into());
    }
    let label = process.engine.label();
    let mut stdin = process.stdin.lock().unwrap();
    let pipe = stdin.as_mut().ok_or_else(|| format!("the {label} is not running"))?;
    pipe.write_all(line.as_bytes())
        .and_then(|_| pipe.write_all(b"\n"))
        .and_then(|_| pipe.flush())
        .map_err(|e| format!("could not write to the {label}: {e}"))
}

/// Which start of the engine is current; the client tags itself with it.
#[tauri::command]
pub fn engine_generation(engine: String, engines: State<Engines>) -> Result<u64, String> {
    Ok(engines.get(&engine)?.generation.load(Ordering::SeqCst))
}

/// Stop an engine and start it again (after a settings change); its work in progress
/// stops. Returns the new generation.
#[tauri::command]
pub fn engine_restart(app: AppHandle, engine: String) -> Result<u64, String> {
    let engines = app.state::<Engines>();
    let process = engines.get(&engine)?;
    stop(process);
    start(&app, process)?;
    Ok(process.generation.load(Ordering::SeqCst))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engines_are_found_by_name() {
        let engines = Engines::new(&[Engine::Dh1, Engine::Eh1]);
        assert_eq!(engines.get("dh1").unwrap().engine, Engine::Dh1);
        assert_eq!(engines.get("eh1").unwrap().engine, Engine::Eh1);
    }

    #[test]
    fn only_the_bridges_go_without_the_agent_settings() {
        assert!(Engine::Dh1.uses_agent_settings());
        assert!(Engine::Eh1.uses_agent_settings());
        assert!(!Engine::Es1.uses_agent_settings());
        assert!(!Engine::Pb1.uses_agent_settings());
    }

    #[test]
    fn pb1s_reset_and_secrets_are_confirmed_and_its_runs_are_not() {
        let local = confirmation(Engine::Pb1, r#"{"id":"r","type":"reset","args":{"metadata_store":"duckdb"}}"#).unwrap();
        assert_eq!(local.title, "Reset this catalog?");
        assert!(local.message.starts_with("Deletes the local DuckDB catalog"));
        let shared = confirmation(Engine::Pb1, r#"{"id":"r","type":"reset","args":{"ducklake_secret":"ducklake_prod"}}"#).unwrap();
        assert!(shared.message.contains("in ducklake_prod") && shared.message.contains("Parquet files already written stay"));

        let save = r#"{"id":"c","type":"secrets_create","args":{"type":"postgres","name":"supabase_pg"},"input":{"values":{"password":"pw-not-shown"}}}"#;
        let ask = confirmation(Engine::Pb1, save).unwrap();
        assert_eq!((ask.title.as_str(), ask.button.as_str()), ("Save the secret supabase_pg?", "Save"));
        assert!(ask.message.contains("postgres secret") && !ask.message.contains("pw-not-shown"));
        let drop = confirmation(Engine::Pb1, r#"{"id":"d","type":"secrets_drop","args":{"name":"old"}}"#).unwrap();
        assert_eq!((drop.title.as_str(), drop.button.as_str()), ("Delete the secret old?", "Delete"));

        for line in [r#"{"id":"r","type":"run","args":{"run_mode":"batch"}}"#, r#"{"id":"s","type":"setup"}"#, r#"{"id":"l","type":"secrets_list"}"#] {
            assert_eq!(confirmation(Engine::Pb1, line), None, "{line}");
        }
        assert_eq!(confirmation(Engine::Es1, save), None);
        assert!(confirmation(Engine::Pb1, "not json").is_some());
    }

    #[test]
    fn only_es1s_publish_needs_confirming() {
        let publish = r#"{"id":"p","type":"draft_publish","profile":"work","args":{"data_plane":"ops/dp/public/x"},"input":{"draft_id":"ab","expect":["acme/a","acme/b"]}}"#;
        let ask = confirmation(Engine::Es1, publish).unwrap();
        assert_eq!(ask.title, "Publish 2 specs to Estuary?");
        assert!(ask.message.contains("profile work, on ops/dp/public/x"));
        assert!(ask.message.contains("• acme/a\n• acme/b"));
        assert_eq!(confirmation(Engine::Es1, r#"{"id":"t","type":"draft_test"}"#), None);
        assert_eq!(confirmation(Engine::Dh1, publish), None);
    }

    #[test]
    fn a_line_that_cant_be_read_is_confirmed_rather_than_sent() {
        assert!(confirmation(Engine::Es1, "not json").is_some());
        assert_eq!(confirmation(Engine::Eh1, "not json"), None);
    }

    #[test]
    fn an_engine_the_host_does_not_run_is_an_error() {
        let engines = Engines::new(&[Engine::Dh1]);
        assert!(engines.get("eh1").err().unwrap().contains("\"eh1\""));
    }
}
