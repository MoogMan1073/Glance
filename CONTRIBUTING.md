# Contributing to Glance

`README.md` is what the app does. `src/help.md` is the in-app cheat sheet.
`CLAUDE.md` is the standing rules. This file is how to run it and what a good
change looks like.

Glance is **0BSD** — do what you like with it, no attribution required. A
contribution is accepted under the same terms.

## Run the gates

```bash
cd tests
npm ci
npx playwright test          # 85 tests
```

That is the whole frontend gate and it needs **no Rust, no Tauri and no
Windows**: `tests/server.mjs` serves `src/` statically and Playwright drives it
in Chromium. It runs on any machine.

Building the app itself does need Rust and WebView2:

```bash
npm ci
npm run dev                  # live
npm run build                # NSIS installer + portable exe (Windows)
```

**`.github/workflows/build.yml` is the authority, not this file.** It runs the
suite on Ubuntu **and** builds the Windows installer on every push and pull
request. It is verification only — publishing lives in `release.yml`, so there
is exactly one path that can produce a release.

## What the suite cannot see, and what to do about it

The tests drive `src/` over a static server, so **everything behind the Tauri
bridge is invisible to them**: file dialogs, saving, `.md` file associations,
tear-off windows, and the single-instance forwarding that makes a second
double-click add a tab rather than launch another copy. So is launch speed,
which is the product's entire claim, and so is what ends up inside the
installer.

A change under `src-tauri/` is therefore verified by **building it and running
it**, and a PR should say which of the two happened. "CI is green" is a true
statement about the frontend and says nothing about the shell.

## Five things that will fail review

- **A framework, or a CDN.** The UI is plain HTML/CSS/JS and every library is
  vendored into `src/vendor/`, because there is no bundled browser to page in
  from disk and that is what makes this launch fast. A CDN also breaks offline
  use and puts a third party in the path of a file the user opened locally.
- **A vendored library added without its notice.** MIT, ISC and the BSD
  licenses require the notice to travel with the **distributed form**, so a new
  library means an entry in `THIRD-PARTY-NOTICES.md`, its text in `licenses/`,
  **and** a check that `bundle.resources` in `src-tauri/tauri.conf.json` still
  copies all three into the installer. A repository can look fully compliant
  while every shipped binary is not.
- **A version bumped in one place.** Five files name it at **six sites** —
  `package.json`, `package-lock.json` twice (its root entry and
  `packages[""]`), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/Cargo.lock`'s entry for the `glance` crate.

  `node scripts/check-versions.mjs` reads all six and CI runs it on **every
  push and pull request**, so this now fails at review rather than at a tag.
  Run it before you push. This bullet used to end *"the other three can drift
  silently"*, which was true: the release read `tauri.conf.json` alone and
  nothing before a tag read anything.
- **Generated output committed.** `test-results/` and `playwright-report/` are
  Playwright's, `src-tauri/target/` is Cargo's. A `.last-run.json` reading
  `"status": "failed"` was committed at the repository root once and read, from
  outside, as this project's tests failing.
- **Anything private.** This is the one public repository here. A customer
  file, an export or an internal document committed to it is world-readable
  permanently, including in history.

## What a good PR looks like here

- **A test that fails before the fix.** Check it by reverting the change and
  watching it go red — a test written from the same assumption as the code pins
  the bug rather than catching it.
- **Editor behaviour gets a test.** Almost all 85 of them are about exactly
  that — column selection, list continuation, tab state — because it is where
  the fiddly bugs live and where a description of the fix reads plausible while
  being wrong.
- **Say which gate passed.** Frontend suite green, built and ran on Windows,
  installed from the installer: three different claims, and only the first is
  something CI can make for you.
- **Docs move with the change.** A new shortcut or toolbar button belongs in
  `src/help.md` and in the README's feature list; the in-app help is what a
  user presses F1 for.

## Releases

Bump the version at all six sites — `node scripts/check-versions.mjs` prints
them and fails until they agree — merge, then push a `vX.Y.Z` tag. The release
runs the same script with the tag as its argument, so it refuses both a tag that
disagrees with the app and a set of declarations that disagree with each other.
A tag that disagrees produces a release whose assets are named after a different
version. It can also be run manually with a `release_tag` input, for
environments where pushing a tag is blocked — it creates the tag itself.

`.claude/skills/license-and-release/` is the full procedure, including the
dependency audit and the check that the notices reached the built artifact.
