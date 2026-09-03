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
cd tests && npm ci && npx playwright test      # the frontend suite
cargo test --manifest-path src-tauri/Cargo.toml # the Rust half (needs GTK, below)
npm run dev                                    # the app (needs Rust + WebView2)
npm run build                                  # installer + portable exe (Windows)
```

That first line carried `# 85 tests` and it was **100** when somebody next ran
it. Nothing reads that number, so nothing turns red when it stops being true —
and it sat two paragraphs above the sentence saying the workflow *"is the
authority"*. Removed rather than restamped, which is the answer four sibling
repos reached on the same day: a number merely updated is wrong again the week
after, and the runner prints the current one.

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

## Two more facts the file had and the editor could not hold

The section above is about a read that *loses* something. These two lose
nothing on the way in — both decode faithfully — and are then written over,
because **what a `<textarea>` can hold is narrower than what a file
contains**. Same shape, one level down, and the same answer: strip it for
display, report it, put it back on write.

- **A BOM is valid UTF-8**, so it reached markdown-it, where it sits in front
  of the first `#` and stops it being a heading. Measured in a real browser
  before anything was changed: `render("﻿# Title\n\ntext")` gives
  `<p>﻿# Title</p>` and the same string without it gives `<h1>Title</h1>`.
  **The first heading of every BOM'd file rendered as body text**, and nothing
  was wrong with the read.
- **A textarea normalises its value to LF.** Measured: `ta.value = "a\r\nb"`
  reads back `"a\nb"`. So a CRLF file **opened dirty** — `d.content` came back
  from the editor as LF against a `savedContent` that was CRLF — and Ctrl+S
  wrote LF over every line ending in the file.

`read_text_file` answers `{ text, lossy, bom, eol }`; `write_text_file` takes
`bom` and `eol` back and restores them before it writes a byte.

- **`"mixed"` is a third answer rather than a guess**, and it is the whole
  reason `eol` is not a bool. Restoring a dominant ending over a file that
  genuinely mixes them rewrites the minority in silence — the defect being
  fixed, wearing a smaller number. Those open read-only with a reason, exactly
  as a lossy read does, and Save As is the way out. The backend refuses that
  write too, and refuses it **before** composing anything, because a refusal
  after the work is a refusal that first made somebody wait for it.
- **The refusal is keyed on what the READ reported, never on the file.**
  `eol == "mixed"` can only come from a caller writing back a file this app
  flattened; *"the file on disk is mixed"* would refuse a person deliberately
  replacing such a file, which is the over-broad rule `write_would_destroy`'s
  conjunction already declines to be.
- **A lone `\r` is not a line ending.** No textarea and no markdown renderer
  treats one as a break, so calling a file that contains one CRLF or LF would
  invent a fact about it. A file whose only breaks are lone `\r` reads `"lf"`
  and has no `\n` to restore, which changes no byte.
- **Save As does not inherit the source's encoding.** It writes a *different*
  file, and giving that one a BOM and CRLF the user never chose is the same
  silent rewrite pointed at a new path. The document then **adopts what was
  actually written**, so the next save round-trips this file rather than the
  one it came from — the same reasoning that clears `readOnly` there.
- **Both travel with a torn-off tab**, like `read_only`, and for a sharper
  reason: `open_in_new_window` rebuilds the document from scratch, so a CRLF
  file torn off and saved in the new window would have every ending rewritten
  — this defect surviving in the one path that starts over.
- **Both default to "no" in the backend**, so a caller that passes neither — a
  new document, or any route added later — writes plain LF with no BOM, which
  is what this app produces on its own.

### It was verified by running it, which is what the section below asks for

`cargo build`, `cargo test` (16) and 100 Playwright tests are three green
ticks over three things that are not the application. So the built binary was
launched under Xvfb with a real BOM + CRLF file as `argv`, driven with
`xdotool`, and the bytes read back off disk:

| | on open | after typing and Ctrl+S |
|---|---|---|
| before | `● bomcrlf.md - Glance` — **dirty with nothing typed** | `EF BB BF … \n … \n … \n ZZZ` |
| after | `bomcrlf.md - Glance` | `EF BB BF … \r\n … \r\n … \r\n ZZZ` |

The typed `ZZZ` is what makes the second column a measurement rather than a
tautology: a save that never fired leaves the file unchanged too.

**The first window was the wrong window.** `xdotool search --pid` returns two
toplevels and the first is named `glance` — the process, not the document — so
the first reading said the title had never been set. The real one is found by
its `_NET_WM_NAME`, which is Decant's own recorded rule for the same script.

### Falsified, each arm on its own defect

Rust, six ways: the BOM strip removed (2), the CRLF flatten removed (2),
`eol_of` blinded to a bare LF (1), the BOM never restored (1), CRLF never
restored (2), and — the floor — CRLF restored **unconditionally**, which fails
`a_caller_that_passes_nothing_writes_plain_lf`.

Frontend, six ways: `openPath` dropping the pair (3 fail), Save As inheriting
the source encoding (1), the `mixed` reason dropped (1), the handoff dropping
the pair on the *receiving* side (1), the document not adopting what was
written (1), and the floor again — `bom: true, eol: 'crlf'` unconditionally,
which fails **8**, five of them tests that predate this change.

**Three of those injections would not apply and said so.** Each rewrite
asserts its anchor changed the file, because an injection that does not apply
reads exactly like a dead gate — and the first three attempts here were
mangled escaping rather than a check that did not fire.

### The stub decodes the way the backend does, and its files hold RAW text

`tauriStub`'s `files` are what is *on disk*, BOM and CRLF included, and the
stubbed `read_text_file` strips and flattens exactly as Rust does. A stub that
stored the display text could never be asked the byte question, which is the
whole claim these tests make — the same rule that already made it answer
`{ text, lossy }` rather than a bare string.

## Three invariants this file states and nothing checked

Each is written down here or in `CONTRIBUTING.md` as a rule somebody must
remember. Two sections above already say what that is worth: *a repository can
look fully compliant while every shipped binary is not*, and *a change to
`src-tauri/` is verified by running it, not by a green tick*. Now they are
gates.

### The notices, checked against what actually ships

`scripts/check-notices.mjs`, run by `build.yml` on every push beside
`check-versions.mjs` — a gate that only runs at release time finds out too
late. Three claims, each asked of the artifact:

- **Every file in `src/vendor/` is covered by a notice, and every coverage
  claim names a file that exists.** Both directions, so a library cannot be
  added without somebody saying which entry covers it, and a stale entry
  cannot sit there naming a file that is gone. `COVERED_BY` is a **declared
  map, not a filename rule**, because the two disagree exactly where it
  matters: `highlight.min.js` is "highlight.js" and `hljs-github-dark.min.css`
  is covered by a themes row — the two entries the notices themselves bold as
  the ones a quick skim gets wrong.
- **Every `bundle.resources` path exists**, and the three the obligation rests
  on are among them. Tauri copies what it finds, so a path that stopped
  resolving does not fail the build.
- **Every license the notices attribute a component to has its text**, inline
  for the short ones and in `licenses/` for Apache-2.0 and Unicode-3.0. The
  license names are read out of the notices' own tables rather than listed in
  the script, because a list in the script is a second copy of the document
  and the document is the thing that drifts.

Falsified eight ways, each naming its own finding: an unattributed vendored
file, `resources` emptied, `licenses/` dropped from it, a resource that no
longer exists, the ISC text removed, `licenses/Apache-2.0.txt` deleted, a
stale `COVERED_BY` entry, and the notices' tables emptied (the floor).

### `npm run build` was the Rust shell's only gate, and it is a compile

`build.yml` ran no `cargo test`, no `clippy`, no `fmt` — so the functions
deciding whether a file is about to be destroyed on save were checked by
nothing but whether they compiled. All three run now, **in the Windows job
rather than a job of their own**: the toolchain, the cache and the platform
dependencies are already there, and a second job would compile the tree twice
for no extra signal. They run **before** the build, so a lint failure is
reported as a lint failure rather than as a build that fell over.

Windows-only, with the reason written into the workflow so nobody "fixes" the
asymmetry — that is the platform the app ships on, and `cargo test` on ubuntu
needs the GTK/WebKit stack installed for a target nothing here builds for.

### Printing put the last render on paper, not the tab you are on

`@media print` hides the toolbar, the tab strip and the editor and **un-hides
`#previewPane`**, so printing from Edit view puts the preview on paper whether
or not anybody has looked at it — and switching tab in Edit view never
re-renders, because there is nothing on screen to re-render. The whole guard
is one `beforeprint` listener, and **no test in the suite mentioned printing
at all**. The failure is silent and lands on paper, which is the one place
this app's output goes that a user cannot check first.

- **The premise is asserted first.** A test that only dispatched
  `beforeprint` and found the right heading would pass over a guard that does
  nothing, if the app happened to re-render on the tab switch — so the preview
  is asserted to be showing the *other* document before the event.
- **`page.emulateMedia({ media: 'print' })`** is what makes the first half a
  measurement rather than an argument: in edit view the preview is hidden, and
  under print media it is visible and the editor is not.
- **Both directions.** A guard that re-rendered on every `beforeprint` would
  satisfy the first test and throw away the preview's scroll position on every
  print of an untouched document, so a probe attribute on the rendered node
  asserts nothing was rebuilt.

Falsified three ways, each on its own arm: the listener removed, the
staleness test dropped, and `display: block !important` taken off
`#previewPane` in the print block.

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
