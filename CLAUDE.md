# Glance — working notes

A quick-to-launch Windows desktop app for reading and editing Markdown:
double-click a `.md` and you are reading it in well under a second.

`README.md` is what it does and how to install it. `src/help.md` is the in-app
help. This file is the standing rules — the things that are easy to break
without noticing.

**This is the one PUBLIC repository in the portfolio.** Anything committed here
is world-readable, permanently, including in history. There are no customer
files, no exports and no internal documents in it and it must stay that way.

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

## Four version declarations, and the tag is a fifth

`package.json`, `package-lock.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml` (plus `Cargo.lock`) each name the version. The release
compares the **tag** against `src-tauri/tauri.conf.json` and refuses on a
mismatch, because a tag that disagrees produces a release whose assets are
named after a different version.

That check reads one of the four. **Bump them together** — the workflow's own
error message says which files to update, and it is the list to follow.

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
