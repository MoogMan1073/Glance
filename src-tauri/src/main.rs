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

/// The first path in `args` that names a real file. Explorer passes the
/// double-clicked document as an argument; WebView2 and the OS may add flags
/// of their own, so pick the argument that actually exists on disk rather
/// than assuming position.
fn file_arg<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

/// The file this process was launched with, if any.
#[tauri::command]
fn launch_file_path() -> Option<String> {
    file_arg(std::env::args())
}

fn main() {
    tauri::Builder::default()
        // Must be registered first: a second launch (double-clicking another
        // .md in Explorer) hands its path to the running window as a new tab
        // instead of starting a rival process.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::{Emitter, Manager};
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                if let Some(path) = file_arg(argv) {
                    let _ = window.emit("open-file", path);
                }
            }
        }))
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
