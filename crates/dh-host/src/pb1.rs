//! PB-1's QUERY: a Terminal window running the duckdb CLI on the catalog PB-1's CATALOG knob
//! points at, attached as `wh`.
//!
//! The face says only which catalog (and, for a secret, its name, checked here); this side
//! writes the init file and the script, so nothing the face sends reaches a shell as text.
//!
//! - The local DuckDB catalog is served by the engine's Quack server (cli-bridge's pb1-serve),
//!   so a run and the terminal can use it at once. The engine writes its init file
//!   (query.sql, with the server's token) when the face asks it to start the server; this only
//!   opens it.
//! - The local Postgres catalog and a DuckLake secret keep their metadata in Postgres, so the
//!   terminal attaches them directly, from an init file written here.
//!
//! Every terminal runs in PB-1's data folder, Duck Harness/Data/pb1, because the local catalogs
//! store their data path as `./ducklake_data/`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::AppHandle;

use crate::settings::{base_dir, shell_quote};

/// Written by the engine, next to the catalog: see cli-bridge's tools/parkbench/quack.py.
const QUACK_INIT: &str = "query.sql";

/// Where the engine runs Parkbench. Matches cli-bridge's default_data_root().
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(base_dir(app)?.join("Data").join("pb1"))
}

/// A DuckDB secret name: it goes into SQL unquoted.
fn secret_name_ok(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        && name.len() <= 63
}

/// The SQL the terminal starts with, for a catalog this side attaches itself.
pub(crate) fn direct_init(catalog: &str, secret: Option<&str>) -> Result<String, String> {
    let attach = match (catalog, secret) {
        ("local_postgres", _) => "ATTACH 'ducklake:postgres:dbname=ducklake_v1 host=localhost' AS wh (DATA_PATH './ducklake_data/');".to_string(),
        ("secret", Some(name)) if secret_name_ok(name) => format!("ATTACH 'ducklake:{name}' AS wh;"),
        ("secret", _) => return Err("that isn't a secret's name".into()),
        _ => return Err(format!("PB-1 can't open a terminal on {catalog:?}")),
    };
    let label = secret.unwrap_or("the local Postgres catalog");
    Ok(format!(
        "-- PB-1's QUERY: DuckDB attached to {label} as wh.\n{attach}\nUSE wh;\n.print 'PB-1 · {label} is attached as wh. Try: SHOW TABLES; SELECT count(*) FROM events;'\n"
    ))
}

/// The script Terminal runs: the duckdb CLI in PB-1's folder, with an init file.
pub(crate) fn script(dir: &Path, init: &Path) -> String {
    format!(
        "#!/bin/zsh -l\n# Opened by PB-1's QUERY: the duckdb CLI on PB-1's catalog.\ncd {} || exit 1\nif ! command -v duckdb >/dev/null; then\n  echo 'The duckdb CLI is not installed. Install it from https://duckdb.org/docs/installation, then press QUERY again.'\n  exit 1\nfi\nexec duckdb -init {}\n",
        shell_quote(&dir.display().to_string()),
        shell_quote(&init.display().to_string()),
    )
}

/// Open Terminal on a catalog: "local_duckdb" (through the engine's Quack server, which the face
/// has started), "local_postgres", or "secret" with the secret's name.
#[tauri::command]
pub fn pb1_query_open(app: AppHandle, catalog: String, secret: Option<String>) -> Result<(), String> {
    let dir = data_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let init = if catalog == "local_duckdb" {
        let path = dir.join(QUACK_INIT);
        if !path.is_file() {
            return Err("The local catalog's Quack server isn't running, so there's nothing to attach to. Press QUERY again.".into());
        }
        path
    } else {
        let path = dir.join("query-direct.sql");
        fs::write(&path, direct_init(&catalog, secret.as_deref())?).map_err(|e| format!("could not write {}: {e}", path.display()))?;
        path
    };
    let launcher = dir.join("query.command");
    fs::write(&launcher, script(&dir, &init)).map_err(|e| format!("could not write {}: {e}", launcher.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&launcher, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Command::new("open")
        .arg(&launcher)
        .status()
        .map_err(|e| format!("could not open Terminal: {e}"))
        .and_then(|s| if s.success() { Ok(()) } else { Err("could not open Terminal".into()) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_secret_is_attached_by_name_and_only_a_name() {
        assert!(direct_init("secret", Some("ducklake_prod")).unwrap().contains("ATTACH 'ducklake:ducklake_prod' AS wh;"));
        for bad in ["", "1x", "a b", "x'; DROP", "x;y"] {
            assert!(direct_init("secret", Some(bad)).is_err(), "{bad:?}");
        }
        assert!(direct_init("secret", None).is_err());
    }

    #[test]
    fn local_postgres_attaches_with_pb1s_data_path() {
        let sql = direct_init("local_postgres", None).unwrap();
        assert!(sql.contains("ducklake:postgres:dbname=ducklake_v1 host=localhost") && sql.contains("DATA_PATH './ducklake_data/'"));
        assert!(sql.contains("USE wh;"));
        assert!(direct_init("anything", None).is_err());
    }

    #[test]
    fn the_script_quotes_its_paths_and_says_when_duckdb_is_missing() {
        let s = script(Path::new("/x/Application Support/pb1"), Path::new("/x/Application Support/pb1/query.sql"));
        assert!(s.contains("cd '/x/Application Support/pb1' || exit 1"));
        assert!(s.contains("exec duckdb -init '/x/Application Support/pb1/query.sql'"));
        assert!(s.contains("command -v duckdb"));
    }
}
