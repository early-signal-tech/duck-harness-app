//! The engines: each device's Python server, run as a child process speaking JSON Lines.
//! A host runs one engine (a standalone app) or several (the rack), each by its name.
//!
//! UI -> engine: `engine_send(engine, line)` writes one request line to its stdin.
//! Engine -> UI: each stdout line is an `engine-message` event, `{engine, line}` (the raw
//! JSON string; the TypeScript client parses it). stderr (the engine's logs) goes to this
//! process's stderr, prefixed with the engine's name. When an engine exits, an
//! `engine-exit` event carries `{engine, generation}`; the generation goes up on every
//! start, so a client connected to a restarted engine can ignore the old one's exit.
//!
//! Settings (settings.rs) apply at start: the Keychain API key becomes ANTHROPIC_API_KEY,
//! and every engine gets the same traces file as an absolute --traces-db.
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

use crate::discovery::{self, Found, Source};
use crate::settings;

/// The engines a host can run, named after the device each one serves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Engine {
    /// DH-1's engine: the agent server (duck-harness-serve, in duckdb-analytics-agent).
    Dh1,
    /// EH-1's engine: the grader (eh1-serve, in eh1-grader).
    Eh1,
}

impl Engine {
    /// The name the web side uses for it.
    pub fn name(self) -> &'static str {
        match self {
            Engine::Dh1 => "dh1",
            Engine::Eh1 => "eh1",
        }
    }

    /// What it's called in errors and log prefixes.
    fn label(self) -> &'static str {
        match self {
            Engine::Dh1 => "agent server",
            Engine::Eh1 => "grader",
        }
    }

    /// Its repo, checked out next to this one in development.
    pub(crate) fn repo(self) -> &'static str {
        match self {
            Engine::Dh1 => "duckdb-analytics-agent",
            Engine::Eh1 => "eh1-grader",
        }
    }

    /// The script a checkout runs.
    pub(crate) fn script(self) -> &'static str {
        match self {
            Engine::Dh1 => "duck-harness-serve",
            Engine::Eh1 => "eh1-serve",
        }
    }

    /// The dev override: a checkout to run instead.
    pub(crate) fn override_var(self) -> &'static str {
        match self {
            Engine::Dh1 => "DH1_AGENT_DIR",
            Engine::Eh1 => "EH1_GRADER_DIR",
        }
    }

    fn log_prefix(self) -> &'static str {
        match self {
            Engine::Dh1 => "[agent]",
            Engine::Eh1 => "[grader]",
        }
    }

    /// The command that starts it, with the settings that apply at start.
    fn command(self, app: &AppHandle, found: &Found) -> Command {
        let mut command = Command::new(&found.program);
        command.args(&found.args).arg("--traces-db").arg(traces_path(app));
        // A checkout runs in its folder, so its .env (ANTHROPIC_API_KEY) is found. An
        // installed engine runs in the app data folder.
        let dir = found.checkout.clone().or_else(|| settings::base_dir(app).ok());
        if let Some(dir) = dir.filter(|d| d.is_dir()) {
            command.current_dir(dir);
        }
        if let Some(key) = settings::api_key() {
            command.env("ANTHROPIC_API_KEY", key);
        }
        command
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

/// Send one request to an engine. `line` is a JSON object; the newline is added here.
#[tauri::command]
pub fn engine_send(engine: String, line: String, engines: State<Engines>) -> Result<(), String> {
    if line.contains('\n') {
        return Err("a request must be a single line of JSON".into());
    }
    let process = engines.get(&engine)?;
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
    fn an_engine_the_host_does_not_run_is_an_error() {
        let engines = Engines::new(&[Engine::Dh1]);
        assert!(engines.get("eh1").err().unwrap().contains("\"eh1\""));
    }
}
