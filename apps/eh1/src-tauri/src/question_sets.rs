//! Your question sets (MINE): EH-1 reads the same folder DH-1 keeps them in,
//! ~/Library/Application Support/Duck Harness/Question Sets/<id>.json, to find the set a
//! setlist ran. Adding and removing sets happens in DH-1's Setlist.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Every set file's contents (unreadable files are skipped).
#[tauri::command]
pub fn question_set_list(app: AppHandle) -> Result<Vec<String>, String> {
    let base = app.path().data_dir().map_err(|e| format!("no data folder: {e}"))?;
    let dir: PathBuf = base.join("Duck Harness").join("Question Sets");
    let Ok(entries) = fs::read_dir(&dir) else { return Ok(vec![]) };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json") && !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')))
        .collect();
    files.sort();
    Ok(files.iter().filter_map(|p| fs::read_to_string(p).ok()).collect())
}
