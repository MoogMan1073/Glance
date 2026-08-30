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
cd tests && npm ci && npx playwright test     # 85 tests
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
