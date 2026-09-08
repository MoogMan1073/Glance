#!/usr/bin/env node
// The two `repository` declarations name the account this checkout belongs to.
//
// WHY THIS IS A GATE AND NOT A SENTENCE. `package.json` and `src-tauri/Cargo.toml`
// each write the GitHub URL down as a literal, because neither format has an
// expression to derive one with — the same shape as a pinned requirement file.
// A literal is right until the account changes, and then it is wrong *silently*:
// nothing reads either field at runtime, so the app builds, installs, and runs
// exactly as before while pointing every reader at a repository that is not
// this one. Glance is one of the two PUBLIC repositories here, so that URL is
// what somebody follows.
//
// A repository RENAME would survive it — GitHub redirects — which is precisely
// why this has never mattered. A repository recreated FRESH under another
// account leaves no redirect at all, so the URL 404s and there is no failure
// anywhere to say so. This turns that into a red build on the first push, with
// the two lines named.
//
// THE ORACLE IS GIT, not a third copy of the account. Comparing the two files
// against each other says only that they agree, which they would while both
// were stale together — the drift-check trap this family records: a staleness
// check that consults the same source as the claim agrees with it.
//
// THREE STATES, NEVER TWO. A checkout with no GitHub `origin` — a tarball, a
// fork pushed elsewhere, a CI runner that checked out by SHA — cannot answer
// the question, and that is not the same as answering it correctly. It says so
// and exits 0, because failing a build for having no remote would make this a
// nuisance somebody removes.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** `owner/name` out of a git remote URL, or null if it names no GitHub repo. */
export function accountFromUrl(url) {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?\s*$/.exec(url ?? "");
  return m ? `${m[1]}/${m[2]}` : null;
}

/** What this checkout's `origin` says, or null when there is nothing to ask. */
function originAccount() {
  try {
    const url = execFileSync("git", ["-C", ROOT, "remote", "get-url", "origin"],
                             { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return accountFromUrl(url.trim());
  } catch {
    return null;
  }
}

/** Every `repository` declaration, as (file, line, the account it names). */
export function declarations(root = ROOT) {
  const out = [];

  const pkgText = readFileSync(join(root, "package.json"), "utf8");
  const pkg = JSON.parse(pkgText);
  const pkgUrl = pkg?.repository?.url ?? null;
  out.push({
    file: "package.json",
    line: pkgText.split("\n").findIndex((l) => l.includes('"url"')) + 1,
    url: pkgUrl,
    account: accountFromUrl(pkgUrl),
  });

  // Read the version-style declaration out of [package], never the first
  // `repository =` in the file: a dependency table can carry one too, and the
  // first match would then be somebody else's crate.
  const cargoText = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
  const lines = cargoText.split("\n");
  let inPackage = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("[")) inPackage = t === "[package]";
    if (!inPackage) continue;
    const m = /^repository\s*=\s*"([^"]*)"/.exec(t);
    if (m) {
      out.push({
        file: "src-tauri/Cargo.toml",
        line: i + 1,
        url: m[1],
        account: accountFromUrl(m[1]),
      });
      break;
    }
  }
  return out;
}

// The parse must DISCRIMINATE, or the comparison below is vacuous: both sides
// of it go through `accountFromUrl`, so one that answered a constant would make
// the manifests agree with git no matter what any of the three said. Found by
// falsification — an arm that gave it a hardcoded fallback came back green,
// because on a correct tree every URL matches and the fallback is unreachable.
const PARSE_CASES = [
  ["https://github.com/Org/Repo.git", "Org/Repo"],
  ["https://github.com/Org/Repo", "Org/Repo"],
  ["git@github.com:Org/Repo.git", "Org/Repo"],
  ["ssh://git@github.com/Org/Repo.git", "Org/Repo"],
  ["https://github.com/Other/Repo.git", "Other/Repo"],
  ["https://gitlab.example/Org/Repo.git", null],
  ["/srv/mirrors/repo.git", null],
  ["", null],
];

function main() {
  const parseFails = PARSE_CASES
    .filter(([url, want]) => accountFromUrl(url) !== want)
    .map(([url, want]) => `${JSON.stringify(url)} parses to ` +
                          `${JSON.stringify(accountFromUrl(url))}, expected ${JSON.stringify(want)}`);
  if (parseFails.length) {
    parseFails.forEach((p) => console.error(`FAIL: ${p}`));
    console.error("      The account parse is what both sides of the comparison " +
                  "below go through; one that does not discriminate makes them agree " +
                  "whatever they say.");
    process.exit(1);
  }

  const found = declarations();
  const problems = [];

  // A FLOOR. "Every declaration agrees" is true of a run that found none, and
  // a renamed key or a moved file is exactly how this check would stop reading
  // anything while still printing OK.
  if (found.length !== 2) {
    console.error(`FAIL: expected 2 repository declarations, read ${found.length}: ` +
                  JSON.stringify(found.map((d) => d.file)));
    console.error("      package.json's repository.url, and [package] repository in " +
                  "src-tauri/Cargo.toml. A key that moved is a check that stopped reading.");
    process.exit(1);
  }
  for (const d of found) {
    if (!d.account) {
      problems.push(`${d.file}:${d.line} — ${JSON.stringify(d.url)} names no GitHub repository`);
    }
  }

  const origin = originAccount();
  if (origin === null) {
    for (const d of found) console.log(`  ${d.file}:${d.line}  ${d.account ?? "(unreadable)"}`);
    console.log("SKIPPED: this checkout has no GitHub `origin` remote, so there is " +
                "nothing to compare the two declarations against.");
    console.log("         They were read and parsed; whether they name the right " +
                "account is a question only a remote can answer.");
    if (problems.length) { problems.forEach((p) => console.error(`FAIL: ${p}`)); process.exit(1); }
    process.exit(0);
  }

  for (const d of found) {
    if (d.account && d.account !== origin) {
      problems.push(`${d.file}:${d.line} — names ${d.account}, but this checkout's ` +
                    `origin is ${origin}`);
    }
  }

  if (problems.length) {
    problems.forEach((p) => console.error(`FAIL: ${p}`));
    console.error("");
    console.error("Both are literals because neither format can derive a URL. Edit the " +
                  "lines above to match the remote — this is what an account move looks " +
                  "like from inside a repository that cannot see one.");
    process.exit(1);
  }
  console.log(`OK: 2 repository declarations, both naming ${origin}.`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
