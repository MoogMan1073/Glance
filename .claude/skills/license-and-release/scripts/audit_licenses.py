#!/usr/bin/env python3
"""Audit the licenses of everything a project ships.

Resolves what actually links into the built artifact (not just what the lockfile
resolves), groups by license, pulls verbatim copyright lines from local package
sources, and flags the cases that need human judgment.

    python audit_licenses.py --repo . --target x86_64-pc-windows-msvc
    python audit_licenses.py --repo . --json > audit.json

Exit status is 0 unless --strict is passed and blocking findings exist.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# Licenses that constrain redistribution of a binary. MPL/LGPL are "check the
# scope" rather than "stop"; GPL/AGPL in a shipped artifact is a real decision.
COPYLEFT_STOP = ("GPL-2.0", "GPL-3.0", "AGPL")
COPYLEFT_SCOPED = ("MPL-", "LGPL")

COPYRIGHT_RE = re.compile(
    r"^\s*(?:#|//|\*|;)?\s*(Copyright\s*(?:\(c\)|©|\(C\))?\s*.+)$",
    re.IGNORECASE | re.MULTILINE,
)
# Phrases from license *bodies* that contain the word "copyright" but are not
# anybody's copyright notice. Without this filter you end up attributing
# "copyright notice that is included in or attached to the work" (Apache-2.0
# §1) to a crate, which is both wrong and obviously wrong to a reader.
BOILERPLATE_RE = re.compile(
    r"(shall be included|included in or attached|means the|Licensor|"
    r"AND PERMISSION NOTICE|copyright notice and this|retain the above|"
    r"reproduce the above|copyright ownership|copyright holder|"
    r"copyright and related|notice file|to the copyright|"
    r"copyright license to|copyright, patent|"
    # Unfilled template placeholders from license appendices, e.g. Apache-2.0's
    # "Copyright {yyyy} {name of copyright owner}".
    r"\{yyyy\}|\[yyyy\]|<year>|name of copyright owner|<name of author>)",
    re.IGNORECASE,
)
YEAR_RE = re.compile(r"(19|20)\d{2}")
LICENSE_FILE_RE = re.compile(r"^(LICEN[CS]E|COPYING|NOTICE)", re.IGNORECASE)
BANNER_RE = re.compile(r"/\*!(.{0,400}?)\*/", re.DOTALL)


def run(cmd, cwd=None):
    """Run a command, returning stdout or None on failure."""
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout if r.returncode == 0 else None


def copyright_from_dir(directory: Path):
    """First copyright line found in a package's license files, verbatim.

    Verbatim matters: years, ranges, and holders vary in ways that are easy to
    "tidy up" into a fabricated notice.
    """
    if not directory or not directory.is_dir():
        return "", ""
    try:
        names = sorted(p for p in directory.iterdir() if p.is_file() and LICENSE_FILE_RE.match(p.name))
    except OSError:
        return "", ""
    fallback = ""
    fallback_file = ""
    for path in names:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for m in COPYRIGHT_RE.finditer(text):
            # Strip whitespace only — never punctuation. "Dropbox, Inc." losing
            # its period is a corrupted legal notice, and this script exists to
            # reproduce these lines exactly.
            line = m.group(1).strip()
            if BOILERPLATE_RE.search(line):
                continue
            if YEAR_RE.search(line):
                return line, path.name  # a year is the strongest signal of a real notice
            if not fallback:
                fallback, fallback_file = line, path.name
    if fallback:
        return fallback, fallback_file
    return "", (names[0].name if names else "")


# ---------------------------------------------------------------- Rust / Cargo


def audit_cargo(manifest: Path, target: str | None):
    """Resolve the crates that actually link into the binary.

    A lockfile lists every package for every platform and build stage. Filtering
    to the shipped target and dropping build/dev edges and proc-macro subtrees is
    what separates "in the binary" from "in the lockfile" — the difference that
    makes naive scans over-report copyleft.
    """
    cmd = ["cargo", "metadata", "--format-version", "1", "--manifest-path", str(manifest)]
    if target:
        cmd += ["--filter-platform", target]
    raw = run(cmd)
    if raw is None:
        return None, ["cargo metadata failed (is cargo installed and the manifest valid?)"]

    meta = json.loads(raw)
    pkgs = {p["id"]: p for p in meta["packages"]}
    resolve = meta.get("resolve") or {}
    roots = list(meta.get("workspace_members", []))
    if resolve.get("root"):
        roots = [resolve["root"]]

    # `cargo tree -e normal,no-proc-macro` is the authority on what links into the
    # binary. cargo metadata cannot substitute: it unifies a crate's features
    # across build and runtime into a single node, so a dependency pulled in only
    # by a compile-time unit is indistinguishable from one in the output. Trusting
    # metadata alone over-reports (it counted 190 where the real figure was 149,
    # inventing four MPL crates that the Windows binary never contained).
    tree_cmd = ["cargo", "tree", "--manifest-path", str(manifest),
                "-e", "normal,no-proc-macro", "--prefix", "none", "--format", "{p}"]
    if target:
        tree_cmd += ["--target", target]
    tree_raw = run(tree_cmd)

    notes = []
    linked_names = None
    if tree_raw is not None:
        linked_names = set()
        for line in tree_raw.splitlines():
            line = line.strip().removesuffix(" (*)").strip()
            m = re.match(r"^(\S+)\s+v(\S+)", line)
            if m:
                linked_names.add((m.group(1), m.group(2)))
    else:
        notes.append(
            "cargo tree unavailable — falling back to cargo metadata, which unifies "
            "build and runtime features and therefore over-reports. Treat copyleft "
            "findings as 'verify with cargo tree -i <crate>' rather than confirmed."
        )

    items = []
    for pid, p in sorted(pkgs.items()):
        if pid in roots:
            continue
        if linked_names is not None and (p["name"], p["version"]) not in linked_names:
            continue
        lic = p.get("license") or ""
        src = Path(p["manifest_path"]).parent if p.get("manifest_path") else None
        cr, cr_file = copyright_from_dir(src)
        if not lic and p.get("license_file"):
            lic = f"(see {p['license_file']})"
        if not cr and p.get("authors"):
            cr = f"(inferred from authors) {', '.join(p['authors'])}"
        items.append(
            {
                "name": p["name"],
                "version": p["version"],
                "license": lic or "UNKNOWN",
                "copyright": cr,
                "copyright_source": cr_file,
                "repository": p.get("repository") or "",
            }
        )

    notes.append(
        f"{len(items)} crates link into the binary"
        + (f" for {target}" if target else "")
        + f"; {len(pkgs)} packages resolve overall. Report the former — the gap is "
        "build tooling and other platforms, which ship nothing."
    )
    return items, notes


# ------------------------------------------------------------------ npm / Node


def audit_npm(pkg_json: Path):
    root = pkg_json.parent
    nm = root / "node_modules"
    items, notes = [], []

    try:
        own = json.loads(pkg_json.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, ["could not read package.json"]

    prod = set(own.get("dependencies", {}))
    if not nm.is_dir():
        notes.append(
            "node_modules absent — listing declared runtime dependencies only. "
            "Install and re-run for the full transitive set."
        )
        for name in sorted(prod):
            items.append({"name": name, "version": own["dependencies"][name],
                          "license": "UNRESOLVED", "copyright": "",
                          "copyright_source": "", "repository": ""})
        return items, notes

    seen = set()
    for pj in sorted(nm.glob("**/package.json")):
        parts = pj.parts
        # Skip nested package.json files that aren't a package root.
        if parts.count("node_modules") > 3 or pj.parent.name in ("dist", "src", "lib", "test"):
            continue
        try:
            d = json.loads(pj.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        name, ver = d.get("name"), d.get("version")
        if not name or not ver or (name, ver) in seen:
            continue
        seen.add((name, ver))
        lic = d.get("license")
        if isinstance(lic, dict):
            lic = lic.get("type", "")
        elif isinstance(lic, list):
            lic = " OR ".join(x.get("type", str(x)) if isinstance(x, dict) else str(x) for x in lic)
        cr, cr_file = copyright_from_dir(pj.parent)
        items.append(
            {
                "name": name,
                "version": ver,
                "license": lic or "UNKNOWN",
                "copyright": cr,
                "copyright_source": cr_file,
                "repository": (d.get("repository") or {}).get("url", "")
                if isinstance(d.get("repository"), dict)
                else (d.get("repository") or ""),
            }
        )
    notes.append(
        f"{len(items)} installed packages scanned. devDependencies and tree-shaken "
        "code create no obligation — narrow this to what the build actually emits."
    )
    return items, notes


# ------------------------------------------------------- vendored / minified JS


def audit_vendored(repo: Path):
    """Report banners in committed bundles, and warn about what they hide."""
    found = []
    for d in ("vendor", "src/vendor", "assets/vendor", "static/vendor", "public/vendor",
              "lib/vendor", "third_party", "src/lib/vendor"):
        vdir = repo / d
        if not vdir.is_dir():
            continue
        for f in sorted(vdir.glob("**/*")):
            if f.suffix.lower() not in (".js", ".css", ".mjs") or not f.is_file():
                continue
            try:
                head = f.read_text(encoding="utf-8", errors="replace")[:4000]
            except OSError:
                continue
            m = BANNER_RE.search(head)
            banner = " ".join(m.group(1).split()) if m else ""
            lic = ""
            lm = re.search(r"@?license[:\s]+\{?([A-Za-z0-9.\-+]+)\}?", banner, re.IGNORECASE)
            if lm:
                lic = lm.group(1)
            cr = ""
            cm = COPYRIGHT_RE.search(head)
            if cm:
                cr = cm.group(1).strip()
            found.append(
                {
                    "file": str(f.relative_to(repo)),
                    "banner": banner[:200],
                    "license": lic or "UNKNOWN",
                    "copyright": cr,
                    "bytes": f.stat().st_size,
                }
            )
    return found


# ------------------------------------------------------------------- reporting


def analyze(items):
    """Split findings into things that block, things to decide, things to note.

    Dual-licensed crates are aggregated rather than listed: in a typical Rust
    tree most of the graph is `MIT OR Apache-2.0`, and one line per crate buries
    the handful of findings that actually need a decision.
    """
    blocking, decide, note = [], [], []
    dual = []
    for it in items:
        lic = it["license"]
        up = lic.upper()
        label = f"{it['name']} {it['version']}"
        if lic in ("UNKNOWN", "UNRESOLVED"):
            blocking.append(f"{label}: no license declared — no permission to redistribute by default")
        elif any(g in up for g in COPYLEFT_STOP):
            blocking.append(f"{label}: {lic} — copyleft in a shipped artifact; confirm this is intended")
        elif any(g in up for g in COPYLEFT_SCOPED):
            note.append(f"{label}: {lic} — scoped copyleft; confirm it is truly linked "
                        f"(cargo tree -i {it['name']}) and publish a source URL (MPL §3.2)")
        if " AND " in f" {up} ":
            decide.append(f"{label}: {lic} — AND, not OR: every listed license applies, you cannot elect one")
        elif " OR " in f" {up} " or "/" in lic:
            dual.append(label)
        if not it["copyright"]:
            note.append(f"{label}: no copyright line in its license file — find it upstream "
                        "(often a source header); do not invent one")
    if dual:
        shown = ", ".join(dual[:3])
        decide.append(
            f"{len(dual)} crates are dual-licensed (e.g. {shown}) — elect one across the "
            "board, usually MIT, and say so once in the notices rather than per crate"
        )
    return blocking, decide, note


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=".", help="project root")
    ap.add_argument("--target", default=None, help="build target triple (Rust), e.g. x86_64-pc-windows-msvc")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a report")
    ap.add_argument("--strict", action="store_true", help="exit non-zero if blocking findings exist")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    result = {"repo": str(repo), "ecosystems": {}, "vendored": [], "notes": []}

    manifests = [p for p in (repo / "Cargo.toml", repo / "src-tauri" / "Cargo.toml") if p.is_file()]
    for m in manifests:
        items, notes = audit_cargo(m, args.target)
        if items is not None:
            result["ecosystems"][f"cargo:{m.relative_to(repo)}"] = items
            result["notes"] += notes

    pj = repo / "package.json"
    if pj.is_file():
        items, notes = audit_npm(pj)
        if items is not None:
            result["ecosystems"]["npm"] = items
            result["notes"] += notes

    result["vendored"] = audit_vendored(repo)

    all_items = [i for v in result["ecosystems"].values() for i in v]
    blocking, decide, note = analyze(all_items)
    result["blocking"], result["decide"], result["review"] = blocking, decide, note

    if args.json:
        json.dump(result, sys.stdout, indent=2)
        print()
        return 1 if (args.strict and blocking) else 0

    print(f"# License audit — {repo.name}\n")
    if not result["ecosystems"] and not result["vendored"]:
        print("No Cargo, npm, or vendored files detected. See references/auditing.md "
              "for Python, Go, and other ecosystems.\n")

    for eco, items in result["ecosystems"].items():
        buckets = {}
        for it in items:
            buckets.setdefault(it["license"], []).append(it)
        print(f"## {eco} — {len(items)} packages, {len(buckets)} distinct licenses\n")
        for lic, group in sorted(buckets.items(), key=lambda kv: -len(kv[1])):
            names = ", ".join(f"{g['name']} {g['version']}" for g in group[:4])
            more = f", +{len(group) - 4} more" if len(group) > 4 else ""
            print(f"- **{lic}** ({len(group)}): {names}{more}")
            holders = sorted({g["copyright"] for g in group if g["copyright"]})
            for h in holders[:4]:
                print(f"    - {h}")
        print()

    if result["vendored"]:
        print(f"## Vendored files — {len(result['vendored'])}\n")
        for v in result["vendored"]:
            print(f"- `{v['file']}` — {v['license']}" + (f" — {v['copyright']}" if v["copyright"] else ""))
        print(
            "\n> A banner describes only the top-level library. Bundles routinely contain\n"
            "> dependencies under other licenses with no banner of their own. Look up each\n"
            "> package's declared dependencies and confirm presence functionally — a failed\n"
            "> string search is weak evidence of absence.\n"
        )

    for title, rows in (("Blocking", blocking), ("Decide", decide), ("Review", note)):
        if rows:
            print(f"## {title}\n")
            for r in sorted(set(rows))[:40]:
                print(f"- {r}")
            if len(set(rows)) > 40:
                print(f"- … +{len(set(rows)) - 40} more")
            print()

    for n in result["notes"]:
        print(f"> {n}")

    return 1 if (args.strict and blocking) else 0


if __name__ == "__main__":
    sys.exit(main())
