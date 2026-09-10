#!/usr/bin/env node
// The licensing invariant, which CLAUDE.md calls invisible from inside the
// repository and which nothing checked.
//
//   "A repository can look fully compliant while every shipped binary is not.
//    Adding or replacing a vendored library means updating the notices *and*
//    checking they are still in `resources`."
//
// Both halves fail quietly. A new file in `src/vendor/` ships in the installer
// the moment it is committed -- `frontendDist` is `../src` -- with no notice
// naming it, and MIT, ISC and the BSD licenses require the notice to travel
// with the DISTRIBUTED FORM. And a `bundle.resources` entry that stops
// resolving does not fail the build: Tauri copies what it finds.
//
// Three things are checked, and each is asked of the artifact rather than of a
// sentence about it:
//
//   1. every file in `src/vendor/` is covered by a notice, and every coverage
//      claim names a file that exists -- BOTH directions, so a new library
//      cannot be added without somebody saying which entry covers it and a
//      stale entry cannot sit there naming a file that is gone;
//   2. every path `bundle.resources` names exists on disk, and the three the
//      obligation rests on are among them;
//   3. every license the notices attribute a component to has its text here --
//      inline for the short ones, in `licenses/` for the long ones.
//
// Exits 1 and names every finding. Run bare; `build.yml` runs it on every push
// and pull request, beside `check-versions.mjs`, for the same reason: a gate
// that only runs at release time is a gate that finds out too late.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const p = (...xs) => join(ROOT, ...xs);

// Which notices entry covers which vendored file.
//
// A DECLARED MAP rather than a filename rule, because the filenames and the
// library names genuinely disagree: `highlight.min.js` is "highlight.js" and
// `hljs-github-dark.min.css` is a theme the notices cover under a row of its
// own. A rule that guessed would be wrong about exactly the two entries the
// notices bold as the ones a quick skim gets wrong.
//
// The value is a string the notices must contain. It is checked in both
// directions against `src/vendor/`, so this table cannot silently go stale.
const COVERED_BY = {
  "markdown-it.min.js": "[markdown-it](",
  "markdown-it-footnote.min.js": "[markdown-it-footnote](",
  "markdown-it-deflist.min.js": "[markdown-it-deflist](",
  "markdown-it-mark.min.js": "[markdown-it-mark](",
  "markdown-it-sub.min.js": "[markdown-it-sub](",
  "markdown-it-sup.min.js": "[markdown-it-sup](",
  "markdown-it-emoji.min.js": "[markdown-it-emoji](",
  "markdown-it-attrs.browser.js": "[markdown-it-attrs](",
  "markdown-it-task-lists.min.js": "[markdown-it-task-lists](",
  "highlight.min.js": "[highlight.js](",
  "hljs-github.min.css": "highlight.js `github` / `github-dark` themes",
  "hljs-github-dark.min.css": "highlight.js `github` / `github-dark` themes",
};

// The three the obligation rests on. `resources` may legitimately carry more.
const REQUIRED_RESOURCES = ["../LICENSE", "../THIRD-PARTY-NOTICES.md", "../licenses"];

// A license named in the notices must have its text reachable from them.
// Short ones are inline as `### <name> License`; long ones are files.
const LICENSE_TEXT = {
  "MIT": { inline: "### MIT License" },
  "ISC": { inline: "### ISC License" },
  "BSD-2-Clause": { inline: "### BSD 2-Clause License" },
  "BSD-3-Clause": { inline: "### BSD 3-Clause License" },
  "Apache-2.0": { file: "licenses/Apache-2.0.txt" },
  "Unicode-3.0": { file: "licenses/Unicode-3.0.txt" },
};

const problems = [];
const fail = (m) => problems.push(m);

// ---- 1. src/vendor/ against the notices, both directions ----------------

const notices = readFileSync(p("THIRD-PARTY-NOTICES.md"), "utf8");
const vendor = readdirSync(p("src", "vendor")).filter((f) => !f.startsWith("."));

// The floor. Every check below is satisfied by an empty vendor directory and
// an empty table, which is what a rename or a move degrades to -- and it reads
// exactly like a project with nothing to attribute.
if (vendor.length < 10) {
  fail(`src/vendor/ holds only ${vendor.length} file(s) — re-aim this check`);
}
if (Object.keys(COVERED_BY).length < 10) {
  fail("COVERED_BY has been emptied — re-aim this check");
}

for (const f of vendor) {
  const needle = COVERED_BY[f];
  if (!needle) {
    fail(`src/vendor/${f} ships in the installer and no entry in this script `
       + "says which notice covers it. Add it to COVERED_BY, after adding the "
       + "library to THIRD-PARTY-NOTICES.md.");
  } else if (!notices.includes(needle)) {
    fail(`src/vendor/${f} is claimed to be covered by ${JSON.stringify(needle)}, `
       + "which THIRD-PARTY-NOTICES.md does not contain.");
  }
}
for (const f of Object.keys(COVERED_BY)) {
  if (!vendor.includes(f)) {
    fail(`COVERED_BY names src/vendor/${f}, which is not there. A stale claim `
       + "of coverage is how a real gap gets waived.");
  }
}

// ---- 2. the notices actually ship ---------------------------------------

const conf = JSON.parse(readFileSync(p("src-tauri", "tauri.conf.json"), "utf8"));
const resources = conf?.bundle?.resources ?? {};
const names = Object.keys(resources);
if (names.length === 0) {
  fail("tauri.conf.json declares no bundle.resources at all, so the installer "
     + "carries no LICENSE and no notices — which satisfies nothing for "
     + "somebody who downloads an .exe.");
}
for (const want of REQUIRED_RESOURCES) {
  if (!names.includes(want)) {
    fail(`bundle.resources does not carry ${want}, so it is not in the installer.`);
  }
}
for (const src of names) {
  // Relative to src-tauri/, which is where tauri.conf.json resolves them.
  const abs = resolve(p("src-tauri"), src);
  if (!existsSync(abs)) {
    fail(`bundle.resources names ${src}, which does not exist. Tauri copies `
       + "what it finds, so this does not fail the build.");
  } else if (src.endsWith("licenses") && !statSync(abs).isDirectory()) {
    fail(`bundle.resources names ${src} as a directory and it is not one.`);
  }
}

// ---- 3. every license named has its text -------------------------------

// Read the licenses out of the notices' own tables rather than from a list
// here: a list here is a second copy of the document, and the document is the
// thing that drifts.
const named = new Set();
for (const line of notices.split("\n")) {
  if (!line.trimStart().startsWith("|")) continue;
  for (const key of Object.keys(LICENSE_TEXT)) {
    // `**BSD-3-Clause**` and `BSD-3-Clause` both count; the notices bold the
    // rows a skim gets wrong.
    if (line.includes(key)) named.add(key);
  }
}
if (named.size < 4) {
  fail(`only ${named.size} license(s) found in the notices' tables — the `
     + "extraction has stopped finding them, which reads like a project with "
     + "nothing to attribute");
}
for (const key of named) {
  const where = LICENSE_TEXT[key];
  if (where.inline && !notices.includes(where.inline)) {
    fail(`${key} is attributed in THIRD-PARTY-NOTICES.md and its text is not `
       + `there (expected a "${where.inline}" section).`);
  }
  if (where.file && !existsSync(p(where.file))) {
    fail(`${key} is attributed in THIRD-PARTY-NOTICES.md and ${where.file} is `
       + "missing, so the installer ships an attribution with no license text.");
  }
}

// ---- report -------------------------------------------------------------

if (problems.length) {
  console.error("Licensing check FAILED:\n");
  for (const m of problems) console.error(`  - ${m}`);
  console.error(
    "\nSee .claude/skills/license-and-release/ for the procedure, including "
    + "the audit.");
  process.exit(1);
}
console.log(
  `Licensing OK: ${vendor.length} vendored file(s) attributed, `
  + `${names.length} resource(s) shipping, ${named.size} license(s) with text.`);
