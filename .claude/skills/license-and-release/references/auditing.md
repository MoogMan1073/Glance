# Auditing dependency licenses

`scripts/audit_licenses.py` automates most of this. Read this file when the scanner
flags something needing judgment, when the project is in an ecosystem the scanner
doesn't cover, or when you need to verify a suspicious result by hand.

## The goal

Produce, for everything that ends up in the shipped artifact: name, version, SPDX
id, and the verbatim copyright line. Everything else is in service of that.

## Rust / Cargo

```bash
cargo metadata --format-version 1 --filter-platform x86_64-pc-windows-msvc
cargo tree --target x86_64-pc-windows-msvc -e normal
```

`--filter-platform` alone is not enough. A lockfile resolves packages for every
target and dependency kind; only some link into the binary. To get the real set,
walk `resolve.nodes` from the root package following only normal dependency edges
(`dep_kinds[].kind == null` — exclude `build` and `dev`), and skip any package whose
`targets[].kind` contains `proc-macro`, along with everything reachable only
through one. Macro crates run at compile time and are not in the output.

This distinction is not academic: it's the difference between correctly reporting
one MPL-2.0 crate in the binary and wrongly reporting five.

Copyright lines live in the package source in the local registry cache:

```
~/.cargo/registry/src/*/<crate>-<version>/LICENSE*
```

A crate declaring `MIT OR Apache-2.0` usually ships `LICENSE-MIT` and
`LICENSE-APACHE`. If no LICENSE file exists, fall back to the `authors` field in its
`Cargo.toml` and note that the copyright line was inferred.

For a mechanical cross-check: `cargo install cargo-about && cargo about generate`.

## npm / Node

If `node_modules` is present, read each package's `package.json` `license` field and
its `LICENSE*` file. Without it, `npm ls --all --json` or the lockfile gives the tree,
but you'll need the registry for license text.

Only what you actually ship counts. A bundler that tree-shakes, or a `devDependency`
used only for tests, does not create an obligation. Frontend builds are the common
case where the shipped set is much smaller than the installed set.

## Vendored and minified files — the highest-risk area

A committed `vendor/` directory of minified bundles is where wrong notices come
from, because **a bundle can contain libraries under licenses its banner never
mentions.**

Real example: `markdown-it.min.js` carries `@license MIT`, and also contains
`entities` (BSD-2-Clause, a different copyright holder), plus `linkify-it`, `mdurl`,
`uc.micro`, and `punycode.js`. None of those appear in the banner. Notices written
from banners alone would attribute other people's code to the wrong authors and
omit an entire license.

Procedure for each vendored file:

1. Read the banner (`/*! ... */`, usually the first line) for name, version, license.
2. Look up that package's **declared dependencies** at that version — those are your
   candidates for hidden bundled code.
3. Confirm whether each candidate is actually in the file. Two methods:
   - **Fingerprint**: grep for library internals (distinctive constants, error
     strings, function names that survive minification).
   - **Functional test**: exercise a feature only that library provides. Load the
     bundle and call it. This is the stronger method.
4. Identify unbannered files by hashing against the published artifact:
   `sha256sum vendor/x.js`, compare to the npm tarball or CDN copy. This pins an
   exact version instead of guessing.

**A failed string probe is weak evidence of absence.** Minifiers rename identifiers
and re-encode data tables, so a library can be present with none of its recognizable
strings intact. If a fingerprint search comes back empty but the package declares the
dependency, test functionally before concluding it isn't there.

Dependencies used only by a package's CLI (a common one is `argparse`) are typically
*not* in the browser bundle — verify rather than assuming either way.

## Python

`pip-licenses --format=json --with-license-file`, or read `METADATA` in each
`.dist-info` directory. Note that wheels often omit the license file even when the
metadata names a license.

## Go

`go-licenses report ./...`, or walk the module cache. Vendored code lives in
`vendor/`, which makes the shipped set explicit.

## Reading SPDX expressions

- `MIT OR Apache-2.0` — elect one. State which in the notices.
- `BSD-3-Clause AND MIT` — both apply. Reproduce both.
- `MIT OR Apache-2.0 OR LGPL-2.1-or-later` — scanners flag the LGPL string; electing MIT resolves it. Check first whether the crate is even in your shipped set.
- Slash form (`MIT/Apache-2.0`) — deprecated pre-SPDX-2.1 spelling for `OR`.

## What to escalate

Most audits come back entirely permissive. Raise these with the user:

- **GPL/AGPL in a shipped binary** — genuinely constrains distribution.
- **Missing or unparseable license** — no permission granted by default; the safe reading is that you may not redistribute it.
- **`AND` expressions** — easy to under-satisfy.
- **Copyleft that a naive scan reports but the binary doesn't contain** — worth stating explicitly, since scanners will keep flagging it and the user will keep being alarmed.
