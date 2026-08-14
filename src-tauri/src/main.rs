// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{Manager, State};

/// Files handed over by a second launch. The webview registers its `open-file`
/// listener asynchronously, so an emit that lands during startup would be
/// dropped on the floor; the frontend drains this once it is ready.
#[derive(Default)]
struct Pending(Mutex<Vec<String>>);

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

/// `\\?\C:\x` and `\\?\UNC\server\share` are what canonicalize returns on
/// Windows. They work, but they would leak into tab tooltips and defeat the
/// already-open check, which compares paths as strings.
fn strip_verbatim(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy().into_owned();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path
    }
}

/// The first argument that names a real file, resolved to an absolute path.
///
/// Explorer passes the double-clicked document as an argument, but WebView2 and
/// the OS may add flags of their own, so position is unreliable. `base` is the
/// working directory the arguments came from — a second launch reports its own,
/// which is the only way a relative argument resolves to the file the user
/// actually clicked rather than a same-named file next to the running process.
fn file_arg<I: IntoIterator<Item = String>>(args: I, base: Option<&Path>) -> Option<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .map(|p| match (p.is_absolute(), base) {
            (false, Some(b)) => b.join(p),
            _ => p,
        })
        .find(|p| p.is_file())
        .map(|p| {
            let resolved = fs::canonicalize(&p).map(strip_verbatim).unwrap_or(p);
            resolved.to_string_lossy().into_owned()
        })
}

/// The file this process was launched with, if any.
#[tauri::command]
fn launch_file_path() -> Option<String> {
    let cwd = std::env::current_dir().ok();
    file_arg(std::env::args(), cwd.as_deref())
}

/// Drain files queued by a second launch before the frontend was listening.
#[tauri::command]
fn take_pending_files(state: State<Pending>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut v| std::mem::take(&mut *v))
        .unwrap_or_default()
}

fn main() {
    tauri::Builder::default()
        // Must be registered first: a second launch (double-clicking another
        // .md in Explorer) hands its path to the running window as a new tab
        // instead of starting a rival process.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            use tauri::Emitter;
            // Resolve against the *second* instance's working directory: that
            // is where a relative argument was typed or dropped from.
            let path = file_arg(argv, Some(Path::new(&cwd)));
            if let Some(p) = path.clone() {
                // Queue before emitting, so a window still booting can pick it
                // up on startup instead of losing the file silently. Opening the
                // same path twice is harmless — the frontend switches to its tab.
                if let Some(state) = app.try_state::<Pending>() {
                    if let Ok(mut q) = state.0.lock() {
                        q.push(p);
                    }
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                if let Some(p) = path {
                    let _ = window.emit("open-file", p);
                }
            }
        }))
        .manage(Pending::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            launch_file_path,
            take_pending_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running Glance");
}
