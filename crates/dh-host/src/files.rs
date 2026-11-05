//! Files the person picks in an Open or Save dialog: preset import and export, and
//! EH-1's scorecard CSV.

use std::fs;

/// Read a file the person chose in an Open dialog.
#[tauri::command]
pub fn file_read(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("could not read {path}: {e}"))
}

/// Write a file the person chose in a Save dialog.
#[tauri::command]
pub fn file_write(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("could not write {path}: {e}"))
}
