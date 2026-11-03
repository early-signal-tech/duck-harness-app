//! EH-1's native side: starts its engine, the grader (eh1-grader's eh1-serve), as a child
//! process and passes its JSON Lines protocol to and from the web UI, like DH-1 does for
//! the agent.
//!
//! UI -> engine: `harness_send` writes one request line to its stdin.
//! Engine -> UI: each stdout line is a `harness-message` event; when it exits, a
//! `harness-exit` event carries the start's generation (it goes up on every start).
//!
//! The grader reads the agent's traces: the same file DH-1 writes, from the shared
//! settings (settings.rs), resolved against the agent checkout. The Keychain API key is
//! passed as ANTHROPIC_API_KEY for the judge.
//!
//! Development: both checkouts are siblings of this repo (four levels up from
//! apps/eh1/src-tauri). Set EH1_GRADER_DIR / DH1_AGENT_DIR to point elsewhere, and
//! DH1_UV if `uv` isn't on PATH.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

mod files;
mod question_sets;
mod settings;

#[derive(Default)]
struct Engine {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    generation: AtomicU64,
}

fn sibling(env: &str, name: &str) -> PathBuf {
    std::env::var_os(env)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../..").join(name))
}

/// The agent checkout: where the traces live by default (settings.rs uses it too).
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

fn start_engine(app: &AppHandle) -> Result<(), String> {
    let dir = grader_dir();
    let uv = std::env::var("DH1_UV").unwrap_or_else(|_| "uv".into());
    let mut command = Command::new(&uv);
    command
        .args(["run", "--project"])
        .arg(&dir)
        .arg("eh1-serve")
        .arg("--traces-db")
        .arg(traces_path(app))
        .current_dir(&dir);
    if let Some(key) = settings::api_key() {
        command.env("ANTHROPIC_API_KEY", key);
    }
    let generation = app.state::<Engine>().generation.fetch_add(1, Ordering::SeqCst) + 1;
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start `{uv} run eh1-serve` in {}: {e}", dir.display()))?;

    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let handle = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => {
                    let _ = handle.emit("harness-message", line);
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let _ = handle.emit("harness-exit", generation);
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("[grader] {line}");
        }
    });

    let state = app.state::<Engine>();
    *state.stdin.lock().unwrap() = child.stdin.take();
    *state.child.lock().unwrap() = Some(child);
    Ok(())
}

#[tauri::command]
fn harness_send(line: String, state: State<Engine>) -> Result<(), String> {
    if line.contains('\n') {
        return Err("a request must be a single line of JSON".into());
    }
    let mut stdin = state.stdin.lock().unwrap();
    let pipe = stdin.as_mut().ok_or("the grader is not running")?;
    pipe.write_all(line.as_bytes())
        .and_then(|_| pipe.write_all(b"\n"))
        .and_then(|_| pipe.flush())
        .map_err(|e| format!("could not write to the grader: {e}"))
}

#[tauri::command]
fn engine_generation(state: State<Engine>) -> u64 {
    state.generation.load(Ordering::SeqCst)
}

/// Stop the grader and start it again (after a settings change). Gradings in progress stop.
#[tauri::command]
fn engine_restart(app: AppHandle) -> Result<u64, String> {
    stop_engine(&app.state::<Engine>());
    start_engine(&app)?;
    Ok(app.state::<Engine>().generation.load(Ordering::SeqCst))
}

/// Close stdin (the grader stops its gradings and exits), wait a little, then kill.
fn stop_engine(state: &Engine) {
    state.stdin.lock().unwrap().take();
    if let Some(mut child) = state.child.lock().unwrap().take() {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Engine::default())
        .setup(|app| {
            if let Err(e) = start_engine(app.handle()) {
                eprintln!("{e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            harness_send,
            engine_generation,
            engine_restart,
            settings::settings_get,
            settings::api_key_set,
            settings::api_key_clear,
            settings::traces_db_set,
            settings::traces_shell_open,
            question_sets::question_set_list,
            question_sets::question_set_write,
            files::file_write,
        ])
        .build(tauri::generate_context!())
        .expect("error while building EH-1")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_engine(&app.state::<Engine>());
            }
        });
}
