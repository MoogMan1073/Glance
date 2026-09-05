// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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
    /// Why the document is read-only, when it is. A tab torn off a file that
    /// did not read back as its own bytes must arrive read-only in its new
    /// window too — otherwise the tear-off is a way to lose the guard.
    ///
    /// Spelled `read_only` on both sides deliberately. Every other field here
    /// is one word, so there is no established camelCase convention to follow,
    /// and a `serde(rename)` would put two spellings of one field in play —
    /// which is how a sibling project's `element_name` arrived in JS as
    /// `undefined` and failed silently.
    #[serde(default)]
    read_only: Option<String>,
}

/// Documents waiting for the window created to carry them, keyed by that
/// window's label. The new window redeems its own label over IPC; nothing
/// travels in the URL, which keeps large or oddly encoded text out of it.
#[derive(Default)]
struct Handoffs(Mutex<HashMap<String, HandoffDoc>>);

static NEXT_WINDOW: AtomicUsize = AtomicUsize::new(1);

/// What a read produced, and whether the bytes survived it.
///
/// `lossy` is the whole reason this is a struct rather than a `String`. A
/// caller that only receives the text cannot tell a faithful read from one
/// where every invalid byte became U+FFFD — and it is the *caller* that decides
/// whether to offer a save, which is the act that would make the loss permanent.
#[derive(Serialize)]
struct TextFile {
    text: String,
    lossy: bool,
}

/// U+FFFD, what `from_utf8_lossy` substitutes for a byte it cannot decode.
const REPLACEMENT: char = '\u{FFFD}';

/// Decode for display, and say whether anything was lost doing it.
///
/// Being forgiving about encoding is right for READING: a file with one stray
/// byte should still be legible rather than refusing to open. What was never
/// covered is writing the substitutes back over the original, which destroys
/// the file silently and permanently — the byte is gone from disk and no undo
/// reaches it.
///
/// So the tolerance stays and the fact travels with it. Detect-and-preserve
/// (reading Latin-1 as Latin-1 and writing it back) is the better end state and
/// is deliberately not attempted here: guessing an encoding wrong is its own
/// way to corrupt a file, and this fix has to be one nobody can get wrong.
fn decode_for_display(bytes: &[u8]) -> TextFile {
    match std::str::from_utf8(bytes) {
        Ok(s) => TextFile { text: s.to_owned(), lossy: false },
        Err(_) => TextFile { text: String::from_utf8_lossy(bytes).into_owned(), lossy: true },
    }
}

/// Would writing `contents` over the bytes currently at the path destroy them?
///
/// Exactly the round-trip failure and nothing wider. Both halves are required:
///
/// * the file on disk **is not valid UTF-8**, so this app read it lossily and
///   cannot reproduce it; and
/// * the text about to be written **still carries a substitute**, so what would
///   land is the lossy read rather than something the user retyped.
///
/// A legitimate overwrite fails neither — saving fresh text over a Latin-1 file
/// is the user replacing a document, and the text they typed holds no U+FFFD.
/// A document that genuinely contains a replacement character saved over a
/// valid-UTF-8 file fails neither either. The conjunction is what keeps this a
/// backstop rather than a rule that refuses ordinary work.
fn write_would_destroy(existing: Option<&[u8]>, contents: &str) -> bool {
    match existing {
        Some(bytes) => std::str::from_utf8(bytes).is_err() && contents.contains(REPLACEMENT),
        None => false,
    }
}

#[tauri::command]
fn read_text_file(path: String) -> Result<TextFile, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Could not open {path}: {e}"))?;
    Ok(decode_for_display(&bytes))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    // The frontend opens a lossily-read document read-only, which is where the
    // user is told why. This is the backstop for every route that forgets:
    // a save is the one act that makes the loss permanent, so the refusal is
    // on the side that writes the bytes rather than only on the side that
    // draws the banner.
    if write_would_destroy(fs::read(&path).ok().as_deref(), &contents) {
        return Err(format!(
            "Refusing to save over {path}: it holds bytes that are not valid UTF-8, \
             and this app read them as replacement characters. Saving would write \
             those substitutes over the original and the bytes would be gone. \
             Save a copy under a new name instead."
        ));
    }
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
/// Async on purpose, and it matters: a synchronous command runs on the main
/// thread, and `WebviewWindowBuilder::build()` dispatches window creation to
/// that same thread and waits for it — from a sync command on Windows that is
/// a deadlock that freezes every window in the app. An async command runs on
/// a worker thread, leaving the main thread free to do the actual creating.
#[tauri::command]
async fn open_in_new_window(
    app: AppHandle,
    doc: HandoffDoc,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(), String> {
    let n = NEXT_WINDOW.fetch_add(1, Ordering::Relaxed);
    let label = format!("win-{n}");

    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Glance")
        .inner_size(1080.0, 740.0)
        .min_inner_size(480.0, 320.0)
        .visible(false); // the page shows itself once painted, as the first window does

    // Windows declared in tauri.conf.json get the bundle icon automatically;
    // ones built at runtime do not, and would show a blank taskbar button.
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder
            .icon(icon)
            .map_err(|e| format!("Could not set the window icon: {e}"))?;
    }

    match (x, y) {
        // Land where the tab was dropped rather than jumping to the centre.
        (Some(x), Some(y)) => builder = builder.position(x, y),
        _ => builder = builder.center(),
    }

    // Insert only once the builder is fully prepared, so an early return
    // cannot leave a document stranded in the store.
    app.state::<Handoffs>()
        .0
        .lock()
        .map_err(|_| "handoff store unavailable".to_string())?
        .insert(label.clone(), doc);

    if let Err(e) = builder.build() {
        // Do not strand the document in the store if the window never appeared.
        if let Ok(mut store) = app.state::<Handoffs>().0.lock() {
            store.remove(&label);
        }
        return Err(format!("Could not open a new window: {e}"));
    }
    Ok(())
}

/// Claim the document this window was opened to display, if any.
#[tauri::command]
fn take_handoff(window: WebviewWindow, state: State<Handoffs>) -> Option<HandoffDoc> {
    state.0.lock().ok()?.remove(window.label())
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
        .setup(|app| {
            // Assert the icon explicitly rather than relying on the window
            // having picked it up from the bundle.
            if let Some(icon) = app.default_window_icon().cloned() {
                for (_, window) in app.webview_windows() {
                    let _ = window.set_icon(icon.clone());
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
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

#[cfg(test)]
mod tests {
    //! The first tests this crate has had, and they cover the one thing the
    //! Playwright suite cannot reach by construction: `CLAUDE.md` records that
    //! the suite runs against `src/` with no Tauri and no Rust, so everything
    //! behind the bridge — including the code that decides whether a file is
    //! about to be destroyed — was gated by nothing at all.
    //!
    //! Both functions under test are pure for exactly that reason. A rule that
    //! only exists inside a `#[tauri::command]` is a rule no check can reach.

    use super::*;

    /// `0xE9` is `é` in Latin-1 and is not valid UTF-8 on its own. It is the
    /// byte the row was reported with.
    const LATIN1: &[u8] = b"caf\xE9 notes";

    #[test]
    fn valid_utf8_reads_faithfully_and_is_not_lossy() {
        let got = decode_for_display("café notes".as_bytes());
        assert_eq!(got.text, "café notes");
        assert!(!got.lossy);
    }

    #[test]
    fn an_invalid_byte_still_reads_and_says_it_was_lost() {
        // The tolerance is deliberate: the file opens. What is new is that the
        // caller can tell, which is what stops the substitute being written back.
        let got = decode_for_display(LATIN1);
        assert!(got.text.contains(REPLACEMENT), "{:?}", got.text);
        assert!(got.lossy);
        assert_ne!(got.text.as_bytes(), LATIN1);
    }

    #[test]
    fn empty_is_not_lossy() {
        // A floor for the other direction: a rule that answered `lossy` to
        // everything would pass every assertion above and open nothing.
        assert!(!decode_for_display(b"").lossy);
    }

    #[test]
    fn the_destruction_case_is_refused() {
        let read_back = decode_for_display(LATIN1).text;
        assert!(write_would_destroy(Some(LATIN1), &read_back));
    }

    #[test]
    fn an_ordinary_overwrite_of_a_latin1_file_is_allowed() {
        // The user replacing the document. Their text carries no substitute, so
        // nothing of the original is being echoed back at it — refusing here
        // would be a rule that blocks real work, which is how a guard gets
        // switched off.
        assert!(!write_would_destroy(Some(LATIN1), "a completely new document"));
    }

    #[test]
    fn a_replacement_character_over_a_valid_file_is_allowed() {
        // Somebody writing *about* U+FFFD. The target round-trips, so there is
        // nothing to lose.
        let target = "# notes".as_bytes();
        assert!(!write_would_destroy(Some(target), "the \u{FFFD} character"));
    }

    #[test]
    fn a_new_file_is_allowed() {
        // Save As to a path that does not exist yet: there are no bytes to
        // destroy. `None` is a third state and not "an empty file".
        assert!(!write_would_destroy(None, "anything \u{FFFD} at all"));
    }

    #[test]
    fn both_halves_are_load_bearing() {
        // Neither condition alone is the rule, asserted rather than commented:
        // dropping either turns the guard into one that refuses ordinary saves
        // or one that refuses nothing.
        // Through a runtime value: rustc's `invalid_from_utf8` lint constant-
        // folds the literal and warns that the call is trivially an error,
        // which is true and is a warning inside an otherwise clean build —
        // the announced-problem-in-a-green-run shape. The claim is the same.
        let bytes = LATIN1.to_vec();
        assert!(std::str::from_utf8(&bytes).is_err());
        assert!(!"a completely new document".contains(REPLACEMENT));
    }
}
