//! Files the person picks in a Save dialog (the scorecard's CSV export).

use std::fs;

/// Write a file the person chose in a Save dialog.
#[tauri::command]
pub fn file_write(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("could not write {path}: {e}"))
}
