//! DH-1's native side: starts the Python agent server (duck-harness-serve) as a child
//! process and passes its JSON Lines protocol to and from the web UI.
//!
//! UI -> server: the `harness_send` command writes one request line to the server's stdin.
//! Server -> UI: each stdout line is emitted as a `harness-message` event (the raw JSON
//! string; the TypeScript client parses it). stderr (the server's logs) goes to this
//! process's stderr. When the server exits, a `harness-exit` event is emitted with the
//! server's generation (it goes up on every start), so a client connected to a restarted
//! server can ignore the old one's exit.
//!
//! Settings (settings.rs) apply at start: the Keychain API key becomes the server's
//! ANTHROPIC_API_KEY, and the traces database setting becomes --traces-db.
//!
//! Development: the server runs from a local checkout of duckdb-analytics-agent with
//! `uv run`. By default that checkout is a sibling of this repo (four levels up from
//! apps/dh1/src-tauri); set DH1_AGENT_DIR to point somewhere else, and DH1_UV if `uv`
//! isn't on PATH.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

mod presets;
mod settings;

#[derive(Default)]
struct Harness {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    generation: AtomicU64,
}

pub(crate) fn agent_dir() -> PathBuf {
    std::env::var_os("DH1_AGENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../duckdb-analytics-agent")
        })
}

fn start_server(app: &AppHandle) -> Result<(), String> {
    let dir = agent_dir();
    let uv = std::env::var("DH1_UV").unwrap_or_else(|_| "uv".into());
    // The working directory is the agent checkout, so its .env (ANTHROPIC_API_KEY) is
    // found and traces land in its agent_traces.duckdb, the same file the CLI uses.
    // A Keychain key and a traces setting override those.
    let mut command = Command::new(&uv);
    command.args(["run", "--project"]).arg(&dir).arg("duck-harness-serve").current_dir(&dir);
    if let Some(key) = settings::api_key() {
        command.env("ANTHROPIC_API_KEY", key);
    }
    if let Some(traces) = settings::load(app).traces_db {
        command.arg("--traces-db").arg(traces);
    }
    let generation = app.state::<Harness>().generation.fetch_add(1, Ordering::SeqCst) + 1;
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!("could not start `{uv} run duck-harness-serve` in {}: {e}", dir.display())
        })?;

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
            eprintln!("[harness] {line}");
        }
    });

    let state = app.state::<Harness>();
    *state.stdin.lock().unwrap() = child.stdin.take();
    *state.child.lock().unwrap() = Some(child);
    Ok(())
}

/// Send one request to the server. `line` is a JSON object; the newline is added here.
#[tauri::command]
fn harness_send(line: String, state: State<Harness>) -> Result<(), String> {
    if line.contains('\n') {
        return Err("a request must be a single line of JSON".into());
    }
    let mut stdin = state.stdin.lock().unwrap();
    let pipe = stdin.as_mut().ok_or("the agent server is not running")?;
    pipe.write_all(line.as_bytes())
        .and_then(|_| pipe.write_all(b"\n"))
        .and_then(|_| pipe.flush())
        .map_err(|e| format!("could not write to the agent server: {e}"))
}

/// Which start of the server is current; the client tags itself with it.
#[tauri::command]
fn engine_generation(state: State<Harness>) -> u64 {
    state.generation.load(Ordering::SeqCst)
}

/// Stop the server and start it again (after a settings change). Any runs are cancelled.
/// Returns the new generation.
#[tauri::command]
fn engine_restart(app: AppHandle) -> Result<u64, String> {
    stop_server(&app.state::<Harness>());
    start_server(&app)?;
    Ok(app.state::<Harness>().generation.load(Ordering::SeqCst))
}

/// Close the server's stdin (end of input cancels its runs and it exits), then wait a
/// few seconds for it before killing it.
fn stop_server(state: &Harness) {
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
        .manage(Harness::default())
        .setup(|app| {
            if let Err(e) = start_server(app.handle()) {
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
            presets::preset_list,
            presets::preset_write,
            presets::preset_delete,
            presets::file_read,
            presets::file_write
        ])
        .build(tauri::generate_context!())
        .expect("error while building DH-1")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_server(&app.state::<Harness>());
            }
        });
}
