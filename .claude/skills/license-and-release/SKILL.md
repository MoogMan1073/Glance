---
name: license-and-release
description: Put an open-source license on a project, audit what its dependencies require, generate a THIRD-PARTY-NOTICES file, make sure those notices actually ship inside the built artifact, and cut a version-bumped release. Use this whenever the user mentions licensing a repo, picking a license (MIT, 0BSD, Apache, "most permissive", "no attribution", "public domain"), attribution or copyright notices, third-party/dependency licenses, OSS compliance, "can people use this freely", or shipping/tagging/cutting a release — and also when adding a LICENSE to a project that bundles or vendors any third-party code, even if the user only asks for the license file itself.
---

# License and release

Two jobs that belong together. Licensing says what others may do with your code.
Notices honor what you owe the code you bundled. The release is the only place you
can confirm both actually reached the user.

Run all three phases when setting a project up. Phase 3 alone handles later releases.

## The two failure modes this prevents

**Picking a license that doesn't do what the user thinks.** "MIT" is the reflex
answer for permissive, but MIT *requires attribution* — every redistributor must
carry the copyright notice. A user who says "I don't need credit" has asked for
something MIT does not provide. Get the intent right before writing a file.

**Writing notices that never ship.** A `THIRD-PARTY-NOTICES.md` at the repo root
satisfies nothing for someone who downloads an installer. MIT, ISC, and the BSD
licenses require the notice to travel *with the distributed form*. A repo can look
fully compliant while every shipped binary is not. Phase 3 exists because of this.

---

## Phase 1 — Choose the license

Ask what the user actually wants, and map it. Read
`references/license-choice.md` for the full comparison — including why 0BSD is
usually the right answer for "no credit needed" and the honest argument against it.

The short version:

| What the user says | What they want |
| --- | --- |
| "take it and run", "no need to credit me", "don't care what people do" | **0BSD** — a normal license grant with every condition removed |
| "permissive, but I'd like credit" | MIT |
| "permissive, and I care about patents" | Apache-2.0 |
| "changes must come back to me" | MPL-2.0 (file-level) or GPL (viral) |

Prefer a **license grant** (0BSD, MIT-0) over a **public-domain dedication**
(Unlicense, CC0). Several countries don't let authors abandon copyright, so a
dedication leans on a fallback clause, and CC0 is rejected by OSI and Fedora. A
grant simply works everywhere.

Write `LICENSE` with the verbatim SPDX text, then declare the same SPDX identifier
in every manifest the project has (`Cargo.toml`, `package.json`, `pyproject.toml`,
`*.csproj`, …). Mismatched declarations are what trip dependency scanners.

Copyright line: use the name the project already uses (check existing manifest
`authors`/`author` fields). Don't invent a legal name from an email address.

---

## Phase 2 — Audit dependencies and write notices

Your own license governs your code only. Everything you bundle keeps its own terms.

Run the bundled scanner first — it does the mechanical work and flags the cases
that need judgment:

```bash
python scripts/audit_licenses.py --repo <path> --target x86_64-pc-windows-msvc
```

It detects Cargo and npm projects, resolves what actually links into the shipped
artifact, groups licenses, extracts real copyright lines from local package
sources, and reports the specific traps below. Pass `--json` to post-process.

The scanner is a starting point, not the answer. These are the things that
silently produce wrong notices, and every one of them cost a correction in real
use:

**Minified bundles hide libraries with different licenses.** A file whose banner
says `@license MIT` can contain a dependency under something else entirely — a
vendored `markdown-it.min.js` bundles `entities`, which is BSD-2-Clause, with no
banner of its own. Never take a banner as the whole story. Check the upstream
package's declared dependencies, then confirm presence by fingerprint (grep for
internals) or functionally (exercise a feature only that library provides). If you
probe for a string and don't find it, that is weak evidence — minifiers rename and
re-encode. Prefer a functional test.

**Naive dependency scans over-report.** Lockfiles list every package for every
platform and every build stage. Filter to the shipping target, then drop
build-only and macro subtrees — otherwise you'll attribute copyleft to a binary
that never contained it. Report the linked count, not the lockfile count.

**`AND` is not `OR`.** `MIT OR Apache-2.0` lets you elect one; say which. `BSD-3-Clause
AND MIT` binds you to both. Read the SPDX expression carefully.

**Never invent a copyright year.** Copy the line verbatim from the dependency's own
LICENSE file — some have no year, some have ranges, some name a company rather
than the author. A guessed year is a fabricated legal notice. If you can't find the
file, say so rather than filling the gap.

**Scope copyleft precisely.** MPL-2.0 is file-level: §3.3 explicitly permits shipping
the larger work under any other license, so it rarely blocks anything. But §3.2
requires telling recipients of the *binary* where to get that component's source —
so include the URL. GPL/AGPL in a shipped binary is a genuine problem; escalate it
to the user rather than papering over it.

Write the notices using the structure in `references/notices-template.md`. Per
library: name, version, SPDX id, verbatim copyright line — plus the full text of
every distinct license. Put long texts (Apache-2.0, Unicode-3.0) in a `licenses/`
directory and reference them, so the main file stays readable.

---

## Phase 3 — Make the notices ship, then release

**Wire the notices into the build.** This is the step that's easy to skip and the
one that matters most. Find where the packaging config declares extra files and add
`LICENSE`, the notices file, and `licenses/`:

- Tauri → `bundle.resources` in `tauri.conf.json`
- Electron → `extraResources` in electron-builder config
- Python wheels → `[tool.setuptools.package-data]` or `MANIFEST.in`
- npm → the `files` array in `package.json`
- Go/Rust single binaries → embed (`go:embed`, `include_str!`) or ship alongside in the archive
- Docker → a `COPY` into the image

Then verify it, don't assume. Validate the config against its schema if one exists,
and after the build, list the artifact's contents and confirm the files are inside.

**Bump the version everywhere at once.** Miss one location and the artifact
disagrees with itself. Typical set: language manifest, packaging config, and the
lockfiles that embed the version (`Cargo.lock`, `package-lock.json` — regenerate,
don't hand-edit). Grep for the old version string afterward to catch stragglers.

**Cut the release.** Push a tag if you can. If tag pushes are blocked (common in
sandboxed or proxied environments), add a `workflow_dispatch` input to the release
workflow so CI creates the tag at the built commit instead:

```yaml
on:
  workflow_dispatch:
    inputs:
      release_tag:
        description: "Publish a release under this tag; empty = build only"
        default: ""
# ...
      - uses: softprops/action-gh-release@v2
        if: startsWith(github.ref, 'refs/tags/v') || inputs.release_tag != ''
        with:
          tag_name: ${{ inputs.release_tag || '' }}
          target_commitish: ${{ github.sha }}
```

The release job needs `permissions: contents: write`. Without it the build succeeds
and only the publish step fails, with a misleading "Resource not accessible by
integration" — a confusing way to lose a release.

Finally, confirm the published release actually has its asset attached rather than
trusting a green check.

---

## Reporting back

Tell the user three things: what their license lets people do in plain language,
what the dependencies oblige *them* to do when redistributing, and anything that
genuinely threatens their intent (copyleft in the binary, a missing license). Keep
it short — most audits end in "everything is permissive, nothing blocks you," and
that conclusion is worth stating plainly rather than burying in a table.

If you corrected something you previously got wrong, say so directly. Licensing
errors are quiet, and a user who doesn't hear about the correction can't judge
whether the rest is trustworthy.

## Reference files

- `references/license-choice.md` — comparison of permissive licenses, the
  no-attribution family, grant vs dedication, and how to phrase the tradeoffs
- `references/auditing.md` — per-ecosystem audit commands, where copyright lines
  live, and how to detect libraries hidden inside bundles
- `references/notices-template.md` — the notices file structure, plus verbatim
  MIT / ISC / BSD-2-Clause / BSD-3-Clause texts to paste
