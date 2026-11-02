//! Your own question sets: JSON files in
//! ~/Library/Application Support/Duck Harness/Question Sets/<id>.json, shared by every
//! Duck Harness app (DH-1 runs them, EH-1 grades against them). The built-in sets ship
//! inside the app; these are the ones tied to your data, like an eval on your own lake.
//! The web side owns the format; this only lists, writes, deletes, and reveals files.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

use tauri::{AppHandle, Manager};

/// A set id as a file name: letters, digits, - _ and ., not starting with a dot.
fn safe_id(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('.')
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if ok { Ok(id) } else { Err(format!("not a valid question set id: {id:?}")) }
}

fn sets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().data_dir().map_err(|e| format!("no data folder: {e}"))?;
    Ok(base.join("Duck Harness").join("Question Sets"))
}

/// Every set file's contents (unreadable files are skipped).
#[tauri::command]
pub fn question_set_list(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = sets_dir(&app)?;
    let Ok(entries) = fs::read_dir(&dir) else { return Ok(vec![]) };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json") && !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')))
        .collect();
    files.sort();
    Ok(files.iter().filter_map(|p| fs::read_to_string(p).ok()).collect())
}

/// Save a set (replacing one with the same id), atomically.
#[tauri::command]
pub fn question_set_write(app: AppHandle, id: String, contents: String) -> Result<(), String> {
    let dir = sets_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let id = safe_id(&id)?;
    let path = dir.join(format!("{id}.json"));
    let temp = dir.join(format!(".{id}.json.tmp"));
    fs::write(&temp, contents).map_err(|e| format!("could not save the question set: {e}"))?;
    fs::rename(&temp, &path).map_err(|e| format!("could not save the question set: {e}"))
}

#[tauri::command]
pub fn question_set_delete(app: AppHandle, id: String) -> Result<(), String> {
    let path = sets_dir(&app)?.join(format!("{}.json", safe_id(&id)?));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("could not remove {}: {e}", path.display())),
    }
}

/// Show a set's file in Finder (or the folder, if the file isn't there).
#[tauri::command]
pub fn question_set_reveal(app: AppHandle, id: String) -> Result<(), String> {
    let dir = sets_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let file = dir.join(format!("{}.json", safe_id(&id)?));
    let target = if file.exists() { file } else { dir };
    Command::new("open").arg("-R").arg(&target).status().map_err(|e| format!("could not open Finder: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::safe_id;

    #[test]
    fn ids_are_safe_file_names() {
        assert!(safe_id("analytics-eval").is_ok());
        assert!(safe_id("tpch.v2").is_ok());
        assert!(safe_id("../etc").is_err());
        assert!(safe_id(".hidden").is_err());
        assert!(safe_id("a/b").is_err());
        assert!(safe_id("").is_err());
    }
}
