# THIRD-PARTY-NOTICES structure

## Goal

A reader should be able to answer "what did I get, from whom, and what does it ask
of me?" — and a redistributor should be able to satisfy every obligation by keeping
this one file (plus `licenses/`) alongside the artifact.

## Structure

```markdown
# Third-Party Notices

<Project> is released under the [<LICENSE>](LICENSE), which asks nothing of you.

The libraries <Project> bundles are a separate matter. <one line: permissive?
copyleft?> Most do ask that their copyright notice travel with copies. This file
carries those notices.

Keep this file, and the `licenses/` directory it references, alongside anything
you ship.

## <Bundled group — e.g. "JavaScript and CSS">

<One line on why these ship: which config puts them in the artifact.>

| Library | Version | License | Copyright |
| ------- | ------- | ------- | --------- |
| [name](url) | 1.2.3 | MIT | Copyright (c) 2014 A. Author |

<Call out the entries a skim gets wrong — the one ISC among nine MITs, the library
with two copyright holders. Bold them in the table and explain underneath.>

### Libraries compiled *inside* <bundle file>

<Only if applicable — and it often is. These have no separate file and are
invisible without decompiling, but they ship all the same.>

## <Compiled dependencies — e.g. "Rust crates">

<State the shipped scope explicitly: "N crates linked into the binary, filtered to
<target>, out of M in the lockfile across all platforms." The gap between those
numbers is why naive scans mislead.>

| License | Notes |
| ------- | ----- |
| MIT, Apache-2.0, dual | The majority. |
| **Apache-2.0 only** | `<crate>` offers no MIT alternative → [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt) |
| **BSD-3-Clause** | `<crates>` — Copyright (c) YEAR HOLDER |
| **MPL-2.0** | `<crate>`; source: <url> |

<Then a short list of points that matter: AND vs OR, copyleft scope, crates a
scanner flags that aren't actually shipped.>

## Runtime

<Anything the app requires but does not redistribute — a system webview, a runtime
the installer fetches from the vendor. Worth stating so nobody assumes it's bundled.>

## License texts

<Long texts (Apache-2.0, Unicode-3.0, MPL-2.0) go in `licenses/` and are linked.
Short ones are inlined below.>
```

## Rules that keep it correct

- **Copyright lines are verbatim.** Copy from the dependency's LICENSE file, including
  odd punctuation and missing years. Never synthesize one.
- **Reproduce the license body *and* name the holder.** BSD clause 2 requires "the
  above copyright notice" — a bare license body with no holder doesn't satisfy it.
- **One entry per distinct copyright holder,** not per file. Bundled-together
  libraries by different authors need separate lines.
- **State which license you elect** for dual-licensed dependencies.
- **Don't claim licenses that aren't there.** Listing an SPDX id no shipped component
  uses is a small error that undermines the rest of the document.

## Short license texts

Paste verbatim. Long texts belong in `licenses/` — get them from SPDX or from a
copy already in the local package cache.

### MIT

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### ISC

```
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### BSD 2-Clause

```
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD 3-Clause

Same as BSD 2-Clause plus:

```
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.
```

Clause 3 is a conduct restriction rather than a reproduction one, and it binds you
regardless of your own license — worth a sentence in the notices so it isn't missed.
