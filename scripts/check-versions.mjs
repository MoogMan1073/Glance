#!/usr/bin/env node
// The version is declared in FIVE files at SIX sites, and until now exactly one
// of them was ever read — `src-tauri/tauri.conf.json`, by `release.yml`, at tag
// time. `build.yml` runs on every push and pull request and checked none.
//
// So five of the six could drift for weeks and the first thing to notice would
// be a release whose installer is named after a different version than the app
// reports — which is the failure the tag check exists to prevent, arriving
// through the door it does not watch.
//
// One implementation, two callers: `build.yml` runs it bare on every push, and
// `release.yml` runs it with the tag. A second copy of "where are the versions"
// is a second answer that can disagree with the first.
//
// Usage:  node scripts/check-versions.mjs [vX.Y.Z]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

// Each entry says where to look and how to get the string out. A site nobody
// can extract is reported as a failure rather than skipped — "I could not read
// this one" and "this one agrees" must never share an outcome.
const SITES = [
  ['package.json', () => json('package.json').version],
  ['package-lock.json (root)', () => json('package-lock.json').version],
  ['package-lock.json (packages[""])',
    () => json('package-lock.json').packages[''].version],
  ['src-tauri/tauri.conf.json', () => json('src-tauri/tauri.conf.json').version],
  // Cargo's are TOML. The workspace has one package, so the first `version =`
  // after the `[package]` header is it; anchored on that header rather than on
  // the first match in the file, which would be a dependency's the moment one
  // is added above it.
  ['src-tauri/Cargo.toml', () => {
    const m = read('src-tauri/Cargo.toml')
      .match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
    if (!m) throw new Error('no version under [package]');
    return m[1];
  }],
  // The lockfile's own entry for this crate, found by name so a dependency
  // that happens to sort nearby cannot answer for it.
  ['src-tauri/Cargo.lock (glance)', () => {
    const m = read('src-tauri/Cargo.lock')
      .match(/name\s*=\s*"glance"\s*\nversion\s*=\s*"([^"]+)"/);
    if (!m) throw new Error('no [[package]] named "glance"');
    return m[1];
  }],
];

const found = [];
const broken = [];
for (const [label, get] of SITES) {
  try {
    const v = get();
    if (typeof v !== 'string' || !v) throw new Error('empty');
    found.push([label, v]);
  } catch (err) {
    broken.push([label, err.message]);
  }
}

for (const [label, v] of found) console.log(`  ${v.padEnd(12)} ${label}`);
for (const [label, why] of broken) console.log(`  UNREADABLE   ${label} — ${why}`);

let failed = false;

if (broken.length) {
  console.error(`\n::error::${broken.length} version declaration(s) could not ` +
                `be read. That is not a pass — the file moved or its shape ` +
                `changed, and this check stopped measuring it.`);
  failed = true;
}

const distinct = [...new Set(found.map(([, v]) => v))];
if (distinct.length > 1) {
  console.error(`\n::error::The version is declared ${SITES.length} times and ` +
                `${distinct.length} different values are present: ` +
                `${distinct.join(', ')}. They are bumped together.`);
  failed = true;
}

// The tag is a seventh declaration and no file can see it, so it is passed in.
const tag = process.argv[2];
if (tag) {
  const want = `v${distinct[0]}`;
  console.log(`\n  tag ${tag} vs ${want}`);
  if (tag !== want) {
    console.error(`::error::Tag ${tag} does not match the declared version ` +
                  `${distinct[0]}. Update the versions, or retag.`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`\nOK: ${SITES.length} declaration(s) all read ${distinct[0]}` +
            (tag ? `, and the tag agrees.` : `.`));
