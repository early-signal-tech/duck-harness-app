//! Host settings, shared by every Duck Harness app (the standalone apps and the rack):
//!
//! - The Anthropic API key, in the macOS Keychain (service "Duck Harness"). When set, it's
//!   given to the engine as ANTHROPIC_API_KEY, which wins over the agent checkout's .env.
//! - The traces database path, in ~/Library/Application Support/Duck Harness/settings.json.
//!   Unset means the agent's default, agent_traces.duckdb in the agent checkout.
//!
//! Both take effect when an engine starts; the web side restarts the engines after a change.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::discovery;
use crate::engines::{self, Engines, Started};

const SERVICE: &str = "Duck Harness";
const ACCOUNT: &str = "anthropic-api-key";
pub const DEFAULT_TRACES_DB: &str = "agent_traces.duckdb";

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSettings {
    #[serde(default)]
    pub traces_db: Option<String>,
}

pub(crate) fn base_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().data_dir().map_err(|e| format!("no data folder: {e}"))?;
    Ok(base.join("Duck Harness"))
}

pub(crate) fn load(app: &AppHandle) -> HostSettings {
    base_dir(app)
        .ok()
        .and_then(|dir| fs::read_to_string(dir.join("settings.json")).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, settings: &HostSettings) -> Result<(), String> {
    let dir = base_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let temp = dir.join(".settings.json.tmp");
    fs::write(&temp, text + "\n").map_err(|e| format!("could not save settings: {e}"))?;
    fs::rename(&temp, dir.join("settings.json")).map_err(|e| format!("could not save settings: {e}"))
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Keychain unavailable: {e}"))
}

/// The key saved in the Keychain, if any.
pub fn api_key() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|k| !k.trim().is_empty())
}

/// Whether the agent checkout's .env sets a key (only whether; it isn't read out).
fn env_file_has_key(agent_dir: &Path) -> bool {
    fs::read_to_string(agent_dir.join(".env"))
        .map(|text| {
            text.lines().any(|line| {
                let line = line.trim().trim_start_matches("export ").trim();
                line.strip_prefix("ANTHROPIC_API_KEY=")
                    .map(|v| !v.trim().trim_matches(['"', '\'']).is_empty())
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// The last four characters, for "…abcd".
fn hint(key: &str) -> String {
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("…{tail}")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    /// Where the engine's key comes from: "keychain", "environment", "env-file", or "none".
    api_key_source: &'static str,
    /// The Keychain key's last four characters.
    api_key_hint: Option<String>,
    traces_db: Option<String>,
    default_traces_db: &'static str,
    /// The traces file every engine is given, as an absolute path.
    traces_path: String,
    agent_dir: String,
    /// How each of this host's engines was started: from a checkout, engines.json, or
    /// a dev override.
    engines: Vec<Started>,
    /// Where the discovery file goes, and why it was skipped if it was.
    engines_file: Option<String>,
    engines_file_problem: Option<String>,
}

#[tauri::command]
pub fn settings_get(app: AppHandle, engines: State<Engines>) -> SettingsView {
    let agent_dir = discovery::agent_dir();
    let engines_file = base_dir(&app).ok().map(|d| d.join(discovery::FILE_NAME));
    let engines_file_problem = engines_file
        .as_deref()
        .and_then(discovery::read_file)
        .and_then(|listed| listed.err())
        .map(|why| format!("{} was skipped: {why}", discovery::FILE_NAME));
    let keychain = api_key();
    let source = if keychain.is_some() {
        "keychain"
    } else if std::env::var("ANTHROPIC_API_KEY").map(|k| !k.is_empty()).unwrap_or(false) {
        "environment"
    } else if env_file_has_key(&agent_dir) {
        "env-file"
    } else {
        "none"
    };
    SettingsView {
        api_key_source: source,
        api_key_hint: keychain.as_deref().map(hint),
        traces_db: load(&app).traces_db,
        default_traces_db: DEFAULT_TRACES_DB,
        traces_path: engines::traces_path(&app).display().to_string(),
        agent_dir: agent_dir.display().to_string(),
        engines: engines.started(),
        engines_file: engines_file.map(|p| p.display().to_string()),
        engines_file_problem,
    }
}

#[tauri::command]
pub fn api_key_set(key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() || key.chars().any(char::is_whitespace) {
        return Err("That doesn't look like an API key.".into());
    }
    entry()?.set_password(key).map_err(|e| format!("could not save to the Keychain: {e}"))
}

#[tauri::command]
pub fn api_key_clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("could not remove it from the Keychain: {e}")),
    }
}

/// Set the traces database (None: back to the default).
#[tauri::command]
pub fn traces_db_set(app: AppHandle, path: Option<String>) -> Result<(), String> {
    let path = path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    let mut settings = load(&app);
    settings.traces_db = path;
    save(&app, &settings)
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Open Terminal with the duckdb CLI connected to the traces (through the traces
/// server, which it starts if needed), using the agent's own --traces-shell.
#[tauri::command]
pub fn traces_shell_open(app: AppHandle) -> Result<(), String> {
    let dir = base_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let agent = discovery::agent_dir();
    let traces = engines::traces_path(&app).display().to_string();
    let uv = std::env::var("DH1_UV").unwrap_or_else(|_| "uv".into());
    let script = format!(
        "#!/bin/zsh -l\n# Opened by DH-1 Settings: the duckdb CLI on the agent's traces.\ncd {} && exec {} run agent_harness.py --traces-db {} --traces-shell\n",
        shell_quote(&agent.display().to_string()),
        shell_quote(&uv),
        shell_quote(&traces),
    );
    let path = dir.join("traces-shell.command");
    fs::write(&path, script).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    Command::new("open")
        .arg(&path)
        .status()
        .map_err(|e| format!("could not open Terminal: {e}"))
        .and_then(|s| if s.success() { Ok(()) } else { Err("could not open Terminal".into()) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hint_shows_the_last_four() {
        assert_eq!(hint("sk-ant-abcdWXYZ"), "…WXYZ");
        assert_eq!(hint("ab"), "…ab");
    }

    #[test]
    fn quotes_for_the_shell() {
        assert_eq!(shell_quote("/a b/it's"), r"'/a b/it'\''s'");
    }

    #[test]
    fn finds_a_key_in_env_file() {
        let dir = std::env::temp_dir().join(format!("dh1-env-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(".env"), "OTHER=1\nexport ANTHROPIC_API_KEY=\"sk-ant-x\"\n").unwrap();
        assert!(env_file_has_key(&dir));
        fs::write(dir.join(".env"), "ANTHROPIC_API_KEY=\n").unwrap();
        assert!(!env_file_has_key(&dir));
        fs::remove_dir_all(&dir).unwrap();
    }
}
