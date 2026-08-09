# Choosing a license

## Start from intent, not from names

Users name licenses they've heard of, which is usually MIT. Ask what they want to
happen, then map it — the mismatch between "MIT" and "no credit needed" is the most
common one, and it's invisible unless you check.

Useful questions when intent is unclear:

- Does someone using this have to credit you?
- Do you care whether people sell it, or build closed products on it?
- Do you want changes contributed back?
- Do you need patent protection? (Matters for company projects; rarely for personal ones.)

## The no-attribution family

All of these ask literally nothing of the user. The difference is legal mechanism.

| License | OSI | Mechanism | Notes |
| --- | --- | --- | --- |
| **0BSD** | Yes | Grant | The usual best answer. Zero conditions. Works in every jurisdiction. |
| **MIT-0** | Yes | Grant | MIT minus the attribution clause. Enumerates more verbs than 0BSD. |
| **Unlicense** | Yes | Dedication + fallback | Public-domain dedication; leans on a fallback where dedication isn't recognized. |
| **CC0-1.0** | **No** | Dedication | Rejected by OSI, disallowed by Fedora, explicitly withholds a patent grant. Not for code. |
| **WTFPL** | No | Joke-ish | Never OSI-approved; disallowed at several large companies. Avoid. |

**Grant vs dedication is the real fork.** A dedication tries to abandon copyright,
which several countries (Germany notably) do not permit an author to do — so those
licenses carry a fallback clause to cover the case where the dedication fails. A
grant sidesteps the problem: you keep copyright and simply permit everything.
Recommend a grant unless the user has a specific reason to want dedication.

**Why 0BSD over MIT-0**, when they're functionally equivalent: 0BSD is the one
zero-attribution license on Google's allowed list for patching third-party code
(their policy otherwise bans public-domain-equivalent licensing by name). If anyone
at a large company ever wants to vendor the code, 0BSD clears review and the others
generate a conversation.

**The honest counterargument to 0BSD**, which is worth telling the user rather than
only selling the choice: its grant reads "use, copy, modify, and/or distribute" and
doesn't enumerate "merge, publish, sublicense, sell" the way MIT-0 does. A
conservative reviewer could argue sublicensing and sale aren't expressly granted.
The counter is that the grant runs directly to everyone for any purpose — so no
sublicense is needed — and "with or without fee" covers sale. Real but minor.

## The attribution-required tier

- **MIT** — permissive, short, universally recognized. Requires the notice to travel.
- **BSD-3-Clause** — MIT plus a no-endorsement clause (can't use the author's name to promote derived products).
- **Apache-2.0** — permissive with an express patent grant and a patent-retaliation clause. Verbose, but the right pick when patents matter. §4(a) requires giving recipients a copy of the license.

## The copyleft tier

Only recommend when the user explicitly wants reciprocity.

- **MPL-2.0** — file-level. Modified MPL files stay MPL; the larger work can be anything (§3.3). Mild.
- **LGPL** — library-level, with dynamic-linking nuance.
- **GPL / AGPL** — whole-work viral. AGPL extends to network use.

## Writing the file

Use the verbatim SPDX text — don't paraphrase, and don't reconstruct from memory.
Canonical sources: <https://spdx.org/licenses/>, or the copy shipped inside a
dependency that uses the same license (often already in a local package cache).

0BSD in full:

```
BSD Zero Clause License

Copyright (c) <year> <holder>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

Then declare the SPDX id in every manifest, so scanners and package registries
agree with the file:

```toml
# Cargo.toml
license = "0BSD"
```
```json
// package.json
"license": "0BSD"
```
```toml
# pyproject.toml
license = "0BSD"          # or: license = { text = "0BSD" }
```

GitHub detects the license from the `LICENSE` file via `licensee`; a well-known
verbatim text is what makes the sidebar label appear.
