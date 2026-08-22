// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// Files handed over by a second launch. The webview registers its `open-file`
/// listener asynchronously, so an emit that lands during startup would be
/// dropped on the floor; the frontend drains this once it is ready.
#[derive(Default)]
struct Pending(Mutex<Vec<String>>);

/// A document being moved to its own window. Unsaved text travels with it, so
/// tearing off a dirty tab does not cost the user their edits.
#[derive(Clone, Serialize, Deserialize)]
struct HandoffDoc {
    path: Option<String>,
    content: String,
    saved: String,
}

/// Documents waiting for the window that was opened to carry them. Passing the
/// text through the URL would break on anything large or oddly encoded, so the
/// new window is handed a token and fetches the document over IPC.
#[derive(Default)]
struct Handoffs(Mutex<HashMap<String, HandoffDoc>>);

static NEXT_WINDOW: AtomicUsize = AtomicUsize::new(1);

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

/// Move a document into a window of its own.
///
/// Deliberately a synchronous command: Tauri runs those on the main thread,
/// which is where a window has to be created on Windows.
#[tauri::command]
fn open_in_new_window(
    app: AppHandle,
    doc: HandoffDoc,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(), String> {
    let n = NEXT_WINDOW.fetch_add(1, Ordering::Relaxed);
    let token = format!("handoff-{n}");
    let label = format!("win-{n}");

    app.state::<Handoffs>()
        .0
        .lock()
        .map_err(|_| "handoff store unavailable".to_string())?
        .insert(token.clone(), doc);

    let url = format!("index.html?handoff={token}");
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title("Glance")
        .inner_size(1080.0, 740.0)
        .min_inner_size(480.0, 320.0)
        .visible(false); // the page shows itself once painted, as the first window does

    match (x, y) {
        // Land where the tab was dropped rather than jumping to the centre.
        (Some(x), Some(y)) => builder = builder.position(x, y),
        _ => builder = builder.center(),
    }

    builder.build().map_err(|e| {
        // Do not strand the document in the store if the window never appeared.
        if let Ok(mut store) = app.state::<Handoffs>().0.lock() {
            store.remove(&token);
        }
        format!("Could not open a new window: {e}")
    })?;
    Ok(())
}

/// Claim the document this window was opened to display.
#[tauri::command]
fn take_handoff(state: State<Handoffs>, token: String) -> Option<HandoffDoc> {
    state.0.lock().ok()?.remove(&token)
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
            // Deliver to whichever window the user is looking at. "main" is not
            // a safe assumption once tabs can be torn off into their own
            // windows — that window may well have been closed.
            let target = app
                .webview_windows()
                .into_values()
                .find(|w| w.is_focused().unwrap_or(false))
                .or_else(|| app.get_webview_window("main"))
                .or_else(|| app.webview_windows().into_values().next());
            if let Some(window) = target {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                if let Some(p) = path {
                    let _ = window.emit("open-file", p);
                }
            }
        }))
        .manage(Pending::default())
        .manage(Handoffs::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            launch_file_path,
            take_pending_files,
            open_in_new_window,
            take_handoff
        ])
        .run(tauri::generate_context!())
        .expect("error while running Glance");
}
