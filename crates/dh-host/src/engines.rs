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
//! and the traces database setting becomes --traces-db.
//!
//! Development: engines run from local checkouts with `uv run`. By default those are
//! siblings of this repo (duckdb-analytics-agent, eh1-grader); set DH1_AGENT_DIR /
//! EH1_GRADER_DIR to point elsewhere, and DH1_UV if `uv` isn't on PATH.

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

    fn log_prefix(self) -> &'static str {
        match self {
            Engine::Dh1 => "[agent]",
            Engine::Eh1 => "[grader]",
        }
    }

    /// The command that starts it, with the settings that apply at start.
    fn command(self, app: &AppHandle) -> (Command, String) {
        let uv = std::env::var("DH1_UV").unwrap_or_else(|_| "uv".into());
        let (dir, script) = match self {
            Engine::Dh1 => (agent_dir(), "duck-harness-serve"),
            Engine::Eh1 => (grader_dir(), "eh1-serve"),
        };
        let mut command = Command::new(&uv);
        command.args(["run", "--project"]).arg(&dir).arg(script).current_dir(&dir);
        match self {
            // The working directory is the agent checkout, so its .env (ANTHROPIC_API_KEY)
            // is found and traces land in its agent_traces.duckdb, the same file the CLI
            // uses. The traces setting overrides that.
            Engine::Dh1 => {
                if let Some(traces) = settings::load(app).traces_db {
                    command.arg("--traces-db").arg(traces);
                }
            }
            // The grader reads the agent's traces: the same file DH-1 writes.
            Engine::Eh1 => {
                command.arg("--traces-db").arg(traces_path(app));
            }
        }
        if let Some(key) = settings::api_key() {
            command.env("ANTHROPIC_API_KEY", key);
        }
        (command, format!("`{uv} run {script}` in {}", dir.display()))
    }
}

fn sibling(env: &str, name: &str) -> PathBuf {
    std::env::var_os(env).map(PathBuf::from).unwrap_or_else(|| {
        // This crate is crates/dh-host in duck-harness-app; the engine repos sit next to it.
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..").join(name)
    })
}

/// The agent checkout: DH-1's engine, and where the traces live by default.
pub(crate) fn agent_dir() -> PathBuf {
    sibling("DH1_AGENT_DIR", "duckdb-analytics-agent")
}

fn grader_dir() -> PathBuf {
    sibling("EH1_GRADER_DIR", "eh1-grader")
}

/// The traces file, as an absolute path: the setting if it's absolute, else in the agent checkout.
fn traces_path(app: &AppHandle) -> PathBuf {
    let chosen = settings::load(app).traces_db.unwrap_or_else(|| settings::DEFAULT_TRACES_DB.into());
    let path = PathBuf::from(&chosen);
    if path.is_absolute() { path } else { agent_dir().join(path) }
}

/// One engine's process. Created once per engine when the host starts; the process
/// itself comes and goes with start and stop.
struct Process {
    engine: Engine,
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    generation: AtomicU64,
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
    let (mut command, description) = engine.command(app);
    let generation = process.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start {description}: {e}"))?;

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

    #[test]
    fn checkouts_are_siblings_of_this_repo() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
        if std::env::var_os("DH1_AGENT_DIR").is_none() {
            assert_eq!(agent_dir(), dir.join("duckdb-analytics-agent"));
        }
        if std::env::var_os("EH1_GRADER_DIR").is_none() {
            assert_eq!(grader_dir(), dir.join("eh1-grader"));
        }
    }
}
