//! Your question sets (MINE): EH-1 reads the same folder DH-1 keeps them in,
//! ~/Library/Application Support/Duck Harness/Question Sets/<id>.json, to find the set a
//! setlist ran, and writes to it when you save a quick check as a question. Adding and
//! removing whole sets happens in DH-1's Setlist. (The same code as DH-1's.)

use std::fs;
use std::path::PathBuf;

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
