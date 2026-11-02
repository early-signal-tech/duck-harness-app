//! Preset files on disk. Each device's presets are JSON files in
//! ~/Library/Application Support/Duck Harness/Presets/<device>/<id>.json. The folder
//! isn't tied to this app's identifier, so the standalone apps and the rack share them.
//! The web side owns the format; this only lists, writes, and deletes files.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn safe_name(name: &str) -> Result<&str, String> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok { Ok(name) } else { Err(format!("not a valid preset or device name: {name:?}")) }
}

fn presets_dir(app: &AppHandle, device: &str) -> Result<PathBuf, String> {
    let base = app.path().data_dir().map_err(|e| format!("no data folder: {e}"))?;
    Ok(base.join("Duck Harness").join("Presets").join(safe_name(device)?))
}

/// Every preset file's contents for a device (unreadable files are skipped).
#[tauri::command]
pub fn preset_list(app: AppHandle, device: String) -> Result<Vec<String>, String> {
    let dir = presets_dir(&app, &device)?;
    let Ok(entries) = fs::read_dir(&dir) else { return Ok(vec![]) };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();
    Ok(files.iter().filter_map(|p| fs::read_to_string(p).ok()).collect())
}

/// Write (or replace) one preset. Written to a temporary file first, so a crash can't
/// leave half a preset behind.
#[tauri::command]
pub fn preset_write(app: AppHandle, device: String, id: String, contents: String) -> Result<(), String> {
    let dir = presets_dir(&app, &device)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let path = dir.join(format!("{}.json", safe_name(&id)?));
    let temp = dir.join(format!(".{}.json.tmp", safe_name(&id)?));
    fs::write(&temp, contents).map_err(|e| format!("could not write {}: {e}", temp.display()))?;
    fs::rename(&temp, &path).map_err(|e| format!("could not save {}: {e}", path.display()))
}

#[tauri::command]
pub fn preset_delete(app: AppHandle, device: String, id: String) -> Result<(), String> {
    let path = presets_dir(&app, &device)?.join(format!("{}.json", safe_name(&id)?));
    match fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("could not delete {}: {e}", path.display())),
        _ => Ok(()),
    }
}

/// Read a file the person chose in an Open dialog (preset import).
#[tauri::command]
pub fn file_read(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("could not read {path}: {e}"))
}

/// Write a file the person chose in a Save dialog (preset export).
#[tauri::command]
pub fn file_write(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("could not write {path}: {e}"))
}
