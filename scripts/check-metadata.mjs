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

// AND A THIRD STRING NAMES THE ACCOUNT AND MUST *NOT* BE EDITED.
// `src-tauri/tauri.conf.json`'s `identifier` is `io.github.<account>.glance` —
// lowercase reverse-DNS, which is why the portfolio's own account sweep, which
// greps for the account as spelled in a remote URL, could not see it and
// reported this repository as carrying two literals when it carries three.
//
// Nothing resolves an identifier, so the move cannot break it. What a rewrite
// breaks is the installer: this repository bundles `nsis` and nothing else
// (checked below), and the bundle identifier is what that installer keys its
// install and uninstall registry entries on — so a changed one makes the next
// installer sit BESIDE the previous install rather than upgrading it, and
// anybody who already has Glance gets a second entry in Add/Remove Programs.
//
// Which half of that is measured here: the no-gain half, and it is local. The
// value is written down in exactly one tracked file and no code reads it, so
// changing it can only cost. The upgrade-keying is NSIS behaviour and a desk
// read of the bundler's documentation — there is no Windows in the container
// this was written in.
//
// So the two kinds are checked SEPARATELY and each keeps its own floor. A
// `repository` declaration fails until somebody EDITS it; the identifier fails
// until somebody reads why they must not. Folding them into one sweep would
// give the second the first's remedy, which is the damaging one.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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

// THE ORACLE IS A DIGEST, AND THE ALTERNATIVES WERE MEASURED AND REJECTED.
//
// Comparing the identifier against the account the REMOTE names was the first
// draft and it is the wrong shape for a value that must never change: it is
// correct exactly once — on the day of the move, when it says "this names the
// old account, leave it" — and then it is RED FOR EVER, because the identifier
// will never name the new account. A gate that is permanently red is a gate
// somebody deletes, which this script's own header already refuses one branch
// over about the no-origin case.
//
// Writing the value here as a literal is the other obvious pin, and it puts a
// SECOND COPY of the string into the very file that counts them — so the sweep
// below would report itself and need a waiver, the exemption aimed at exactly
// the text most likely to carry the thing.
//
// A digest is neither. It fires on precisely one event — somebody changed the
// identifier, for any reason — which is the moment the message is worth
// reading, and it stays green through the move because the identifier does not
// move. It is the `.gitattributes`/vendored-drop idiom this portfolio already
// uses for bytes that must not drift.
//
// What announces the string on move DAY is not this: it is the `frozen` row in
// Pathforward's `scripts/transfer_readiness.py` and the runbook's own
// do-not-edit list. One mechanism per job.
const FROZEN_IDENTIFIER_SHA256 =
  "6d5de1b33a93b6f1bfc58bc77cbe5601d404c1ede9de64dda2a09d4524eccad9";

function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** The bundle identifier, its bundle targets, and every tracked file naming it. */
export function identifierState(root = ROOT) {
  const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  const id = conf?.identifier ?? null;
  const raw = conf?.bundle?.targets ?? null;
  const targets = raw === null ? null : (Array.isArray(raw) ? raw : [raw]);
  let named = null;
  if (id) {
    try {
      // The needle is the VALUE, taken from the config rather than typed here.
      // Typing it would put a second copy of the string in the very file that
      // counts them, so this check would report itself and need a waiver — the
      // exemption aimed at exactly the text most likely to carry the thing.
      //
      // `git grep` exits 1 when it matches nothing, which is a legitimate answer
      // and not an error, so the status is not read. Its stated limit is that it
      // reads TRACKED files: an untracked second copy is invisible, which is the
      // safe direction, since a file nobody has committed is not yet a copy
      // anybody else has.
      const out = execFileSync("git", ["-C", root, "grep", "-rIiln", "-F", "--", id],
                               { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      named = out.split("\n").map((l) => l.trim()).filter(Boolean);
    } catch (e) {
      named = (e.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    }
  }
  return { id, targets, named };
}

/** What is wrong with the identifier. Needs no remote: every one of these is
 *  a fact about this checkout, which is why the no-origin path runs them all. */
export function identifierProblems(state) {
  const p = [];
  const { id, targets, named } = state;
  // A FLOOR, and the same one the declaration count is: with the key gone every
  // assertion below passes over nothing, and Tauri requires one — so an absent
  // identifier is a broken config rather than a decision.
  if (!id) {
    p.push("src-tauri/tauri.conf.json declares no `identifier`; Tauri requires one, " +
           "and with the key gone nothing below is checked");
    return p;
  }
  if (id.includes("://") || id.includes("github.com")) {
    p.push(`the identifier is ${JSON.stringify(id)}, which now reads as a URL — an ` +
           "owner-literal sweep judges it as a repository reference, and the reasoning " +
           "above (nothing resolves this) stops describing it");
  }
  const expect = ["nsis"];
  if (targets === null || targets.length !== expect.length ||
      targets.some((t, i) => t !== expect[i])) {
    p.push(`bundle.targets is ${JSON.stringify(targets)}. The note above is written ` +
           "about NSIS keying a Windows install; a different or additional target keys " +
           "something else too — a macOS `.app` keys the bundle id and the keychain — " +
           "and the note has to say so before this passes again");
  }
  if (named === null || named.length !== 1 || named[0] !== "src-tauri/tauri.conf.json") {
    p.push(`the identifier is named by ${JSON.stringify(named)}. The declaration itself ` +
           "is the one expected hit and its absence is the floor. Any other tracked file " +
           "either READS the value — so changing it breaks something local too, and the " +
           "note above is narrower than the truth — or holds a SECOND COPY, which is two " +
           "places to edit and one to forget");
  }
  if (sha256(id) !== FROZEN_IDENTIFIER_SHA256) {
    p.push(`the identifier is now ${JSON.stringify(id)}, which is not the value pinned ` +
           "above.\n" +
           "      IF IT WAS REWRITTEN TO MATCH A NEW ACCOUNT, PUT IT BACK. Nothing " +
           "resolves an identifier, so an account move cannot break it; what a rewrite " +
           "breaks is the upgrade path of every install already out there — the next " +
           "installer sits BESIDE the previous one instead of replacing it.\n" +
           "      IF IT WAS CHANGED DELIBERATELY, for a reason that is not the account: " +
           "re-pin the digest here, and re-read the `frozen` entry for this file in " +
           "Pathforward's scripts/transfer_readiness.py. Re-pinning is one line and this " +
           "message is the whole of the cost.");
  }
  return p;
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
    // The identifier checks need NO remote — its digest, its shape, its bundle
    // target and how many files name it are all facts about this checkout — so
    // they run here in full. This branch withholds only what a remote can
    // answer, which is what keeps "could not ask" from collapsing into
    // "nothing to check".
    problems.push(...identifierProblems(identifierState()));
    console.log("         The identifier was checked in full: nothing about it needs " +
                "a remote.");
    if (problems.length) { problems.forEach((p) => console.error(`FAIL: ${p}`)); process.exit(1); }
    process.exit(0);
  }

  for (const d of found) {
    if (d.account && d.account !== origin) {
      problems.push(`${d.file}:${d.line} — names ${d.account}, but this checkout's ` +
                    `origin is ${origin}`);
    }
  }

  // BOTH KINDS ARE REPORTED TOGETHER, and the ordering is the finding rather
  // than a tidy-up. Exiting on the repository declarations first — which is what
  // the first draft did — means that on the day of the move the reader sees two
  // lines saying EDIT THIS, edits them, and only on the next run meets a third
  // saying DO NOT. By then they have already edited it by analogy, which is the
  // one outcome this check exists to prevent. Measured: the arm that points
  // `origin` at a new organisation fired both repository lines and reached
  // neither identifier line.
  const idProblems = identifierProblems(identifierState());
  if (problems.length || idProblems.length) {
    problems.forEach((p) => console.error(`FAIL: ${p}`));
    if (problems.length) {
      console.error("");
      console.error("      ^ EDIT THESE. Both are literals because neither format can " +
                    "derive a URL, and this is what an account move looks like from " +
                    "inside a repository that cannot see one.");
      // Said HERE because this is the moment somebody is editing account
      // literals in this repository, and the third one is the one a
      // find-and-replace gets wrong. The digest below catches the edit; this
      // is what stops it being made.
      console.error("        A THIRD string names the account — " +
                    "src-tauri/tauri.conf.json's `identifier` — and it must NOT be " +
                    "edited. See this file's header for why; the digest check below " +
                    "fires if it is.");
    }
    idProblems.forEach((p) => console.error(`FAIL: ${p}`));
    if (idProblems.length) {
      console.error("");
      console.error("      ^ DO NOT EDIT THE IDENTIFIER TO MATCH. Nothing resolves it, " +
                    "so the move cannot break it; a rewrite breaks the upgrade path of " +
                    "every install already out there. See this file's header.");
    }
    process.exit(1);
  }

  console.log(`OK: 2 repository declarations, both naming ${origin}.`);
  console.log("OK: the bundle identifier is unchanged, in one place, and is FROZEN — " +
              "the move does not edit it.");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
