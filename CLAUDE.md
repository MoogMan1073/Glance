# Glance — working notes

A quick-to-launch Windows desktop app for reading and editing Markdown:
double-click a `.md` and you are reading it in well under a second.

`README.md` is what it does and how to install it. `src/help.md` is the in-app
help. This file is the standing rules — the things that are easy to break
without noticing.

**This is one of TWO public repositories in the portfolio** — Glance and
**Redline** (`MoogMan1073/Redline`, formerly `PDF_MarkupApp`). Anything
committed here is world-readable, permanently, including in history. There are
no customer files, no exports and no internal documents in it and it must stay
that way.

That line said *"the one PUBLIC repository"* until 2026-08-29, and it was
checked against the account rather than remembered: `list_repos` reports
`visibility` per repo, and two of the fourteen come back public. **A claim
about which repositories are private is exactly the kind that goes stale
silently** — nothing in a checkout knows its own visibility, so the only way to
find out is to ask GitHub. Redline was swept at the same time and is clean: no
drawing files, exports or archives in 172 commits, no customer names in tracked
files, and its private-PyDRC install uses `${{ secrets.PYDRC_TOKEN }}` with no
literal token ever committed.

## Run it

```bash
cd tests && npm ci && npx playwright test     # 114 tests
npm run dev                                    # the app (needs Rust + WebView2)
npm run build                                  # installer + portable exe (Windows)
```

The Playwright suite runs against `tests/server.mjs`, a static server over
`src/` — **no Tauri, no Rust, no Windows**. That is what makes the frontend
testable on any machine, and it is also the limit of what those tests can say:
they exercise the HTML/CSS/JS and nothing behind `__TAURI__`.

`.github/workflows/build.yml` runs the suite on Ubuntu **and** builds the
Windows installer on every push and pull request. It is verification only —
publishing lives in `release.yml`, so there is exactly one path that can
produce a release.

## No framework, and no CDN

The UI is plain HTML/CSS/JS. That is the point rather than an accident: a Tauri
binary is a few megabytes of native code rendering through the WebView2 runtime
Windows already ships, and there is no bundled browser to page in from disk —
which is what makes an Electron app feel slow to launch. A framework would put
the cost back.

Every library is **vendored into `src/vendor/`** — markdown-it and its plugins,
highlight.js and its themes. A CDN load would break offline use and put a third
party in the path of a file the user opened locally.

## Six version declarations, the tag is a seventh, and one script reads them all

Five files carry the version at **six sites**: `package.json`,
`package-lock.json` twice (the root entry *and* `packages[""]`),
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`'s
own entry for the `glance` crate. The `v*` tag is a seventh that no file can see.

**Until now exactly one of them was ever read.** `release.yml` compared the tag
against `tauri.conf.json`, at tag time; `build.yml`, which runs on every push and
pull request, checked none. So five sites could drift for weeks and the first
sign would be a release whose installer is named after a different version than
the app reports — the failure the tag check exists to prevent, arriving through
the door it does not watch.

The tell was in the workflow's own error message: it named *"Cargo.toml,
package.json, the lockfiles"* as the files to update, which is four declarations
it was not looking at. **A message that lists what a check does not check is the
check telling you its own scope.**

`scripts/check-versions.mjs` reads all six and takes the tag as an optional
argument. **One implementation, two callers** — `build.yml` runs it bare on every
push, `release.yml` runs it with the tag — so the release cannot check less than
every push already did, and a second copy of *where are the versions* cannot
disagree with the first.

- **A site it cannot READ is a failure, never a skip.** *"I could not extract
  this one"* and *"this one agrees"* must not share an outcome, which is this
  portfolio's standing rule about a check that stops measuring rather than
  failing. Falsified by renaming the crate in `Cargo.lock`: the run reports
  `UNREADABLE` and exits 1.
- **Cargo's two are found by anchor, not by first match.** The TOML version is
  taken after the `[package]` header — the first `version =` in the file becomes
  a dependency's the moment one is added above it — and the lockfile's is found
  by `name = "glance"`, so a crate that happens to sort nearby cannot answer for
  it.
- Falsified four ways: `package.json` bumped alone, `Cargo.toml` alone,
  `package-lock.json`'s `packages[""]` alone, and a site made unreadable. All
  four exit 1.

## The notices have to ship INSIDE the installer

`THIRD-PARTY-NOTICES.md` at the repository root satisfies nothing for somebody
who downloads an `.exe`. MIT, ISC and the BSD licenses require the notice to
travel with the **distributed form**, so `bundle.resources` in
`src-tauri/tauri.conf.json` copies `LICENSE`, `THIRD-PARTY-NOTICES.md` and
`licenses/` into the bundle.

**A repository can look fully compliant while every shipped binary is not.**
Adding or replacing a vendored library means updating the notices *and*
checking they are still in `resources`. `.claude/skills/license-and-release/`
is the procedure, including the audit.

Glance's own code is **0BSD** — no attribution required, no fee. That is a
deliberate choice rather than a reflex "MIT": MIT *requires* attribution from
every redistributor, which is not what was wanted here.

## A file with any non-UTF-8 byte was destroyed by open-then-save

`read_text_file` ended `String::from_utf8_lossy(&bytes).into_owned()` under a
comment defending exactly that: *"Be forgiving about encoding: replace invalid
UTF-8 rather than failing."* **That comment is right, and it covers reading.**
Nothing covered writing the replacements back over the original — so a file
holding one `0xE9` opened as `caf\u{FFFD}`, and the next Ctrl+S put the
substitute on disk. The byte is gone, permanently, and no undo in this app
reaches it.

**Silent destruction of a user's file was the default by accident rather than
by choice**, which is the whole shape: nobody decided it, the tolerance was
defensible where it was written, and the consequence lived one function away.

- **The tolerance stays. What travels with it is the FACT.** `read_text_file`
  answers `{ text, lossy }` rather than a `String`, because a caller handed
  only the text cannot tell a faithful read from a lossy one — and the caller
  is what decides whether to offer a save, which is the act that makes the loss
  permanent. Refusing to open would be worse: a file with one stray byte should
  still be legible.
- **Detect-and-preserve is the better end state and is deliberately not
  attempted.** Reading Latin-1 as Latin-1 and writing it back is what the file
  deserves; guessing an encoding wrong is its own way to corrupt one, and this
  fix had to be one nobody can get wrong. Read-only with a reason is cheaper and
  strictly safer.
- **Two guards, and the second is not the first restated.** The frontend opens
  the document read-only — **on the textarea**, so it cannot become dirty in the
  first place; a guard only at save would let somebody type for an hour and then
  be told. `write_text_file` then refuses the write itself, which is the backstop
  for every route that forgets, because a save is the one act that is not
  recoverable.
- **The backend refusal is a CONJUNCTION, and both halves keep it a backstop
  rather than a rule that blocks real work.** The file on disk must be invalid
  UTF-8 *and* the text being written must still carry a U+FFFD. Saving fresh
  text over a Latin-1 file is a person replacing a document and passes; a
  document that genuinely discusses U+FFFD saved over a valid file passes.
  Refusing every write to a non-UTF-8 path would have been the obvious rule and
  is the one that gets switched off.
- **`readOnly` on the textarea stops keystrokes and nothing else, so the
  refusal also lives in `replaceRange`.** `execCommand` honours `readOnly` and
  returns false; `setRangeText` — the fallback one line below it — does not,
  and writes anyway. So every toolbar button, every formatting hotkey and live
  view's checkbox click went *around* the textarea's own refusal: Bold on a
  lossily-read file turned `# caf\u{FFFD} notes` into `# **caf\u{FFFD}** notes`,
  dirty, with the backend refusal the only thing left to catch it at save —
  which is precisely the "type for an hour and then be told" this guard exists
  to prevent. One `setRangeText` call site in the file, so one place to refuse.
  Falsified by neutering the check: the toolbar test fails.
- **Save As is the way out, so it has to actually let go.** The document is then
  bound to a file this app wrote and can reproduce exactly, so `readOnly` clears
  on a successful write to a different path. A remedy that leaves the copy
  read-only is worse than none, because it is offered.
- **`read_only` travels with a torn-off tab**, spelled the same in Rust and JS.
  Every other `HandoffDoc` field is one word, so there is no camelCase
  convention to follow and a `serde(rename)` would put two spellings of one
  field in play — which is how a sibling project's `element_name` arrived in JS
  as `undefined` and failed silently.

### The banner is ABOVE the panes, and both reasons are structural

- Read view sets `#editorPane { display: none }`, and a read-only document is
  exactly what a person reads — a banner inside that pane would be invisible in
  the view it matters most in.
- `#selMirror` and `#selOverlay` are positioned against `#editorPane`, the
  overlay at `inset: 0`. Taking vertical space at the top of that pane moves the
  textarea without moving their origin, which is a column-selection drift
  nothing on screen would explain. Twenty-four of the suite's tests are column
  selection.

It is a strip rather than a toast because the reason has to stay on screen: a
toast that has faded leaves an editor that silently will not accept a keystroke.

### This file had no Rust tests at all, and that is why the defect could sit there

`src-tauri/` is behind the Tauri bridge, which the section below says the
Playwright suite cannot see — so the code deciding whether a file is about to be
destroyed was gated by **nothing**. `decode_for_display` and
`write_would_destroy` are pure for exactly that reason: a rule that only exists
inside a `#[tauri::command]` is a rule no check can reach. Eight tests, and they
cover both directions — an `empty_is_not_lossy` floor, because a rule answering
"lossy" to everything would satisfy every assertion about the destruction case
and open nothing.

**`cargo test` needs GTK in this container** and fails on `gdk-3.0` without it;
`apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev` fixes it, which is worth
doing rather than shipping a Rust change verified by reading. The sibling
Decant repo records the same one-line remedy.

Falsified six ways, each on its own test: the lossy flag dropped in `openPath`
(4 fail), the textarea's `readOnly` never set, the save refusal removed, Save As
no longer clearing it, `showDoc` no longer refreshing the banner (3 fail), and
`write_would_destroy` neutered to `false`.

**And the first draft of the test stub broke the file it was in.** A comment
inside `tauriStub`'s template literal wrote `` `{ text, lossy }` `` in backticks,
which **ends the template literal** — and the parse error named a line thirty
lines from the cause, reported as `No tests found`. No backticks inside that
stub.

## Live view is a fourth view, and three things about it are load-bearing

`docs/live-preview-notes.md` is the design record and the measurements. The
rules that are easy to break without noticing:

- **The textarea is never moved, re-parented, or assigned `.value`** — it holds
  the whole document and is shrunk to the caret's block and parked over the gap
  that block leaves in a rendered column. Re-parenting a textarea destroys its
  native undo stack (measured, in the notes), so any change that reaches for
  `appendChild` here silently costs per-tab undo, and nothing on screen says so.
- **`#selMirror` becomes `position: fixed` in live view**, because an absolutely
  positioned full-height mirror is inside `#editorPane`'s scrollable overflow and
  would stretch its scroll range by the height of the raw document (79,628px on
  a large-document probe). Only differences between its rects are used in this
  view, so where it sits does not matter — but it must not be in the scroller.
- **The reveal is driven off `keydown`/`keyup`, not `selectionchange` alone.**
  Chromium throttles `selectionchange`: six arrow presses produced two events,
  and the reveal fell several lines behind the caret. A caret-following feature
  built on that event alone will look broken and test green if the test waits.

## Things the Playwright suite cannot see

- **Anything behind the Tauri bridge** — file dialogs, saving, file
  associations, tear-off windows, the single-instance forwarding that makes a
  second double-click add a tab instead of launching another copy.
- **Launch speed**, which is the product's whole claim.
- **What the installer contains**, including the notices above.

So a change to `src-tauri/` is verified by building and running it, not by a
green tick. Say which of the two you did.

## `test-results/` is Playwright's, not a fixture

It is generated output from a run. Do not commit anything into it and do not
read it as a record of anything but the last local run.
