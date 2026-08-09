// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Could not open {path}: {e}"))?;
    // Be forgiving about encoding: replace invalid UTF-8 rather than failing.
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("Could not save {path}: {e}"))
}

/// The file passed on the command line (set when a .md file is double-clicked
/// in Explorer after the installer registers the file association).
#[tauri::command]
fn launch_file_path() -> Option<String> {
    let arg = std::env::args().nth(1)?;
    let path = PathBuf::from(&arg);
    if path.is_file() {
        Some(path.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            launch_file_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Glance");
}
