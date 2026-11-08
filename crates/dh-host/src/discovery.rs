//! Finding each engine. In order:
//!
//! 1. A dev override: DH1_AGENT_DIR / EH1_GRADER_DIR / ES1_BRIDGE_DIR names a checkout, run with
//!    `uv run --project <dir> <script>` (DH1_UV if `uv` isn't on PATH).
//! 2. The discovery file, ~/Library/Application Support/Duck Harness/engines.json:
//!
//!    ```json
//!    {"format": "dh-engines", "formatVersion": 1,
//!     "engines": {"dh1": {"command": ["/path/to/duck-harness-serve"], "version": "0.1.0"},
//!                 "eh1": {"command": ["/path/to/eh1-serve"], "version": "0.1.0"}}}
//!    ```
//!
//!    `command` is the program and its arguments; the host adds --traces-db for the
//!    engines that use traces. An installed
//!    CLI writes this file; for now it can be written by hand, or left out.
//! 3. A checkout next to this repo (duckdb-analytics-agent, eh1-grader, cli-bridge), as in
//!    development.
//!
//! A missing file is normal. A broken one is skipped (the checkout is used instead) and
//! the problem is shown in Settings.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::engines::Engine;

pub const FILE_NAME: &str = "engines.json";
const FORMAT: &str = "dh-engines";
const FORMAT_VERSION: u32 = 1;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnginesFile {
    format: String,
    format_version: u32,
    #[serde(default)]
    engines: HashMap<String, FileEntry>,
}

#[derive(Clone, Debug, Deserialize)]
struct FileEntry {
    command: Vec<String>,
    #[serde(default)]
    version: Option<String>,
}

/// The engines listed in the discovery file, or why it can't be used. None: no file.
#[derive(Debug)]
pub struct Listed(HashMap<String, FileEntry>);

pub fn read_file(path: &Path) -> Option<Result<Listed, String>> {
    let text = fs::read_to_string(path).ok()?;
    Some(parse(&text))
}

fn parse(text: &str) -> Result<Listed, String> {
    let file: EnginesFile = serde_json::from_str(text).map_err(|e| format!("not valid: {e}"))?;
    if file.format != FORMAT || file.format_version != FORMAT_VERSION {
        return Err(format!(
            "it's {} version {}; this app reads {FORMAT} version {FORMAT_VERSION}",
            file.format, file.format_version
        ));
    }
    for (name, entry) in &file.engines {
        if entry.command.first().is_none_or(|program| program.trim().is_empty()) {
            return Err(format!("the {name} engine has no command"));
        }
    }
    Ok(Listed(file.engines))
}

/// Where an engine was found.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Source {
    /// DH1_AGENT_DIR / EH1_GRADER_DIR / ES1_BRIDGE_DIR.
    Override,
    /// engines.json.
    File,
    /// A checkout next to this repo.
    Checkout,
}

/// How to start an engine.
#[derive(Debug, PartialEq, Eq)]
pub struct Found {
    pub source: Source,
    pub program: String,
    pub args: Vec<String>,
    /// The checkout it runs from (its .env is read there), or None for an installed engine.
    pub checkout: Option<PathBuf>,
    /// From engines.json; a checkout's version isn't known until the engine says hello.
    pub version: Option<String>,
}

impl Found {
    fn checkout(source: Source, engine: Engine, dir: PathBuf, uv: &str) -> Found {
        Found {
            source,
            program: uv.to_string(),
            args: vec!["run".into(), "--project".into(), dir.display().to_string(), engine.script().into()],
            checkout: Some(dir),
            version: None,
        }
    }

    /// The command as one line, for errors and Settings.
    pub fn describe(&self) -> String {
        std::iter::once(self.program.as_str()).chain(self.args.iter().map(String::as_str)).collect::<Vec<_>>().join(" ")
    }
}

/// The folder the engine repos sit in: next to this repo (crates/dh-host is two levels
/// down), as a clean absolute path.
fn siblings_dir() -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    dir.canonicalize().unwrap_or(dir)
}

/// A dev override's checkout, if its variable is set.
fn override_dir(engine: Engine) -> Option<PathBuf> {
    std::env::var_os(engine.override_var()).filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// The agent checkout: where the traces live by default, and whose .env Settings checks.
/// It's the override or the sibling checkout, however DH-1's engine itself was found.
pub fn agent_dir() -> PathBuf {
    override_dir(Engine::Dh1).unwrap_or_else(|| siblings_dir().join(Engine::Dh1.repo()))
}

/// Find an engine: override, then the file, then the sibling checkout.
pub fn find(engine: Engine, listed: Option<&Listed>) -> Found {
    let uv = std::env::var("DH1_UV").unwrap_or_else(|_| "uv".into());
    resolve(engine, override_dir(engine), listed, &siblings_dir(), &uv)
}

fn resolve(engine: Engine, override_dir: Option<PathBuf>, listed: Option<&Listed>, siblings: &Path, uv: &str) -> Found {
    if let Some(dir) = override_dir {
        return Found::checkout(Source::Override, engine, dir, uv);
    }
    if let Some(entry) = listed.and_then(|l| l.0.get(engine.name())) {
        let mut parts = entry.command.iter().cloned();
        return Found {
            source: Source::File,
            program: parts.next().expect("parse checked the command isn't empty"),
            args: parts.collect(),
            checkout: None,
            version: entry.version.clone(),
        };
    }
    Found::checkout(Source::Checkout, engine, siblings.join(engine.repo()), uv)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = r#"{"format": "dh-engines", "formatVersion": 1,
        "engines": {"dh1": {"command": ["/opt/dh/duck-harness-serve", "--verbose"], "version": "0.2.0"}}}"#;

    #[test]
    fn an_override_wins() {
        let listed = parse(FILE).unwrap();
        let found = resolve(Engine::Dh1, Some("/src/agent".into()), Some(&listed), Path::new("/gh"), "uv");
        assert_eq!(found.source, Source::Override);
        assert_eq!(found.describe(), "uv run --project /src/agent duck-harness-serve");
        assert_eq!(found.checkout, Some(PathBuf::from("/src/agent")));
    }

    #[test]
    fn the_file_comes_next() {
        let listed = parse(FILE).unwrap();
        let found = resolve(Engine::Dh1, None, Some(&listed), Path::new("/gh"), "uv");
        assert_eq!(found.source, Source::File);
        assert_eq!(found.program, "/opt/dh/duck-harness-serve");
        assert_eq!(found.args, vec!["--verbose"]);
        assert_eq!(found.checkout, None);
        assert_eq!(found.version.as_deref(), Some("0.2.0"));
    }

    #[test]
    fn an_engine_the_file_leaves_out_is_the_sibling_checkout() {
        let listed = parse(FILE).unwrap();
        let found = resolve(Engine::Eh1, None, Some(&listed), Path::new("/gh"), "/bin/uv");
        assert_eq!(found.source, Source::Checkout);
        assert_eq!(found.describe(), "/bin/uv run --project /gh/eh1-grader eh1-serve");
    }

    #[test]
    fn es1_is_the_bridge_checkout() {
        let found = resolve(Engine::Es1, None, None, Path::new("/gh"), "uv");
        assert_eq!(found.describe(), "uv run --project /gh/cli-bridge es1-serve");
    }

    #[test]
    fn no_file_is_the_sibling_checkout() {
        let found = resolve(Engine::Dh1, None, None, Path::new("/gh"), "uv");
        assert_eq!(found.source, Source::Checkout);
        assert_eq!(found.checkout, Some(PathBuf::from("/gh/duckdb-analytics-agent")));
    }

    #[test]
    fn a_broken_file_says_why() {
        assert!(parse("{").unwrap_err().starts_with("not valid"));
        let other = r#"{"format": "dh-engines", "formatVersion": 2, "engines": {}}"#;
        assert!(parse(other).unwrap_err().contains("version 2"));
        let empty = r#"{"format": "dh-engines", "formatVersion": 1, "engines": {"dh1": {"command": []}}}"#;
        assert!(parse(empty).unwrap_err().contains("dh1"));
    }

    #[test]
    fn sibling_paths_are_clean() {
        let dir = siblings_dir();
        assert!(dir.is_absolute());
        assert!(!dir.display().to_string().contains(".."));
    }
}
