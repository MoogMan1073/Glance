<img src="assets/branding/glance-lockup.png" alt="Glance" width="360">

A simple, **quick-to-launch** Windows desktop app for reading and editing
Markdown files. Built for the gap between "too small for an Obsidian vault"
and "too annoying to wait for VSCode": double-click a `.md` file and you're
reading it in well under a second.

## What it does

- **Three views** — **Read** (rendered document), **Edit** (raw text), and
  **Split** (side-by-side with live preview and synced scrolling).
  Opening a file from Explorer starts in Read view; a new blank file starts
  in Edit view.
- **Tabs** — several documents open at once, browser-style, each keeping its
  own cursor, scroll position and undo history. The tab bar only appears once
  there's a second document, so single-file reading stays clean. Opening a
  `.md` from Explorer adds a tab to the running window instead of launching
  another copy.
- **Tear-off windows** — right-click a tab and pick *Move to New Window*, or
  drag the tab out of the window and drop it. Unsaved text travels with it.
- **Column selection** — Alt+drag selects a rectangle, like Notepad++ and the
  code editors. Drag down for a cursor on every line and type a prefix onto
  all of them at once; the whole edit undoes in one step.
- **Right-click menu** — Obsidian-style formatting menu in the editor, with
  Format / Paragraph / Insert submenus, plus the usual clipboard actions.
- **Word-like toolbar** — headings, bold, italic, strikethrough, highlight,
  inline code, code blocks, links, images, blockquotes, bulleted / numbered /
  checkbox lists, tables, horizontal rules.
- **Full cheat-sheet rendering** — tables, fenced code blocks with syntax
  coloring, footnotes, heading IDs, definition lists, strikethrough, task
  lists, emoji (`:joy:`), ==highlight==, subscript, superscript.
- **Images render in the preview** — web URLs, absolute file paths, and
  paths relative to the open document (`![diagram](images/diagram.png)`).
- **Light / dark mode** — follows your Windows setting by default; the theme
  button cycles System → Light → Dark.
- **Standard Windows behavior** — Save / Save As / Open / New, native file
  dialogs, unsaved-changes prompt, undo/redo, familiar hotkeys.
- **Built-in help** (F1) — a Markdown cheat sheet and the full shortcut list.
- Smart list editing: Enter continues bullets / numbers / checkboxes,
  Enter on an empty item ends the list, Tab / Shift+Tab indent and outdent.
- Drag a `.md` file onto the window to open it.

## Why it's fast

This is a [Tauri](https://tauri.app) app, not an Electron app. The
executable is a few megabytes of native code that renders through the
WebView2 runtime already shipped with Windows 10/11 — there is no bundled
browser to page in from disk, which is what makes Electron apps feel slow to
launch. The UI itself is plain HTML/CSS/JS with no framework.

## Installing

1. Download the latest `Glance_*-setup.exe` from
   [Releases](../../releases) (or grab the `Glance-installer`
   artifact from the latest [Actions](../../actions) run).
2. Run it. The installer (NSIS — same family of tooling as Inno Setup)
   installs per-user, no admin rights needed, and registers the app for
   `.md` and `.markdown` files.
3. **Making it the default:** Windows 10+ does not let installers silently
   take over a file type you've already assigned to another app. If `.md`
   files don't open with Glance right away, right-click any `.md` file →
   **Open with → Choose another app → Glance → Always**. You only do this
   once.

> **SmartScreen note:** the installer is not code-signed, so the first run
> may show "Windows protected your PC" — click *More info → Run anyway*.

## Keyboard shortcuts

| | |
| --- | --- |
| **Files** | Ctrl+N new · Ctrl+O open · Ctrl+S save · Ctrl+Shift+S save as |
| **Tabs** | Ctrl+T new · Ctrl+W close · Ctrl+Tab / Ctrl+Shift+Tab cycle · Alt+1…8 jump · Alt+9 last · right-click or drag out to detach |
| **Views** | Ctrl+1 edit · Ctrl+2 split · Ctrl+3 read |
| **Text** | Ctrl+B bold · Ctrl+I italic · Ctrl+Shift+X strikethrough · Ctrl+Shift+H highlight |
| **Code** | Ctrl+E inline code · Ctrl+Shift+C code block |
| **Structure** | Ctrl+Alt+1…6 heading · Ctrl+Alt+0 paragraph · Ctrl+Shift+Q quote |
| **Lists** | Ctrl+Shift+8 bullets · Ctrl+Shift+7 numbered · Ctrl+Shift+9 checkboxes |
| **Select** | Alt+drag column selection · Esc to end it |
| **App** | Ctrl+K link · Ctrl+Shift+D theme · Ctrl+P print · F1 help |

The full list is in the in-app help (F1).

## Building from source

Prerequisites: [Rust](https://rustup.rs) (stable) and Node.js 18+.

```bash
npm install        # installs the Tauri CLI
npm run dev        # run in development mode
npm run build      # build the release exe + NSIS installer
```

The installer lands in `src-tauri/target/release/bundle/nsis/`.

## Project layout

```
src/                  Frontend: plain HTML/CSS/JS, no build step
  index.html          Toolbar, panes, help overlay
  app.js              All application logic
  help.md             In-app help (F1)
  vendor/             markdown-it + plugins, highlight.js (bundled locally)
src-tauri/            Rust shell: file I/O commands, window, installer config
  tauri.conf.json     Window, NSIS installer, .md file associations
  icons/              App icons, generated from assets/branding
  installer/          NSIS header and sidebar artwork, likewise generated
assets/branding/      Brand sources: mark, lockup, composed app icon
scripts/make_icons.py Regenerates every icon and installer image
tests/                Playwright tests for the frontend
docs/                 The Markdown cheat sheet the help is based on
```

## Design choices

- **Documents are data, not code**: raw HTML in Markdown files is displayed
  as text, never executed, so files from any source (including AI tools) are
  safe to open.
- The editor is a plain text area — no syntax-highlighting editor component.
  That keeps startup instant and behavior predictable; the formatting
  toolbar and hotkeys do the Markdown for you.
- Preferences (theme) persist between sessions; everything else is
  deliberately stateless.

## License

[0BSD](LICENSE) — the BSD Zero Clause License. Take it and run: use, copy,
modify, distribute, or sell it, commercially or not, with **no attribution
required** and no fee. You don't need to credit anyone or ask permission.

The bundled third-party libraries (markdown-it, highlight.js, Tauri and its
Rust dependencies) keep their own permissive licenses — see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Those licenses do ask that
their copyright notices travel with redistributions, so keep that file
alongside the code if you ship a build.
