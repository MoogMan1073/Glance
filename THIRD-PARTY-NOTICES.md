# Third-Party Notices

Glance itself is released under the [BSD Zero Clause License](LICENSE), which
asks nothing of you — no attribution, no fee.

The libraries Glance bundles are a separate matter. They are all permissive
(nothing that restricts commercial use, nothing that forces you to open your
own code), but most of them do ask that their copyright notice travel with
copies of the software. This file carries those notices so that
redistributing Glance — as source or as a compiled installer — satisfies
them.

If you reuse Glance's own code without these libraries, none of this applies.

Keep this file, and the `licenses/` directory it references, alongside
anything you ship.

---

## Bundled JavaScript and CSS

`tauri.conf.json` sets `frontendDist` to `../src`, so everything in
`src/vendor/` is compiled into the installer.

| Library | Version | License | Copyright |
| ------- | ------- | ------- | --------- |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 14.3.0 | MIT | Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin |
| [markdown-it-footnote](https://github.com/markdown-it/markdown-it-footnote) | 4.0.0 | MIT | Copyright (c) 2014-2015 Vitaly Puzrin, Alex Kocharin |
| [markdown-it-deflist](https://github.com/markdown-it/markdown-it-deflist) | 3.0.1 | MIT | Copyright (c) 2014-2015 Vitaly Puzrin, Alex Kocharin |
| [markdown-it-mark](https://github.com/markdown-it/markdown-it-mark) | 4.0.0 | MIT | Copyright (c) 2014-2015 Vitaly Puzrin, Alex Kocharin |
| [markdown-it-sub](https://github.com/markdown-it/markdown-it-sub) | 2.0.0 | MIT | Copyright (c) 2014-2015 Vitaly Puzrin, Alex Kocharin |
| [markdown-it-sup](https://github.com/markdown-it/markdown-it-sup) | 2.0.0 | MIT | Copyright (c) 2014-2015 Vitaly Puzrin, Alex Kocharin |
| [markdown-it-emoji](https://github.com/markdown-it/markdown-it-emoji) | 3.0.0 | MIT | Copyright (c) 2014 Vitaly Puzrin |
| [markdown-it-attrs](https://github.com/arve0/markdown-it-attrs) | 4.5.0 | MIT | Copyright (c) Arve Seljebu &lt;arve.seljebu@gmail.com&gt; (arve0.github.io) |
| [markdown-it-task-lists](https://github.com/revin/markdown-it-task-lists) | 2.1.1 | **ISC** | Copyright (c) 2016, Revin Guillen |
| [highlight.js](https://github.com/highlightjs/highlight.js) | 11.11.1 | **BSD-3-Clause** | see note below |
| highlight.js `github` / `github-dark` themes | 11.11.1 | BSD-3-Clause | ship as part of highlight.js |

Two entries above are deliberately bolded, because they are the ones a quick
skim gets wrong:

- **markdown-it-task-lists is ISC, not MIT**, despite sitting among eight
  MIT-licensed siblings with near-identical filenames. (The npm package is
  2.1.1; its in-file banner reads 2.1.0.)
- **highlight.js has two attributions.** The distributed bundle carries the
  banner `(c) 2006-2024 Josh Goebel <hello@joshgoebel.com> and other
  contributors`, while the upstream `LICENSE` file records
  `Copyright (c) 2006, Ivan Sagalaev`. Both are reproduced here.

### Libraries compiled *inside* `markdown-it.min.js`

These have no separate file in `src/vendor/` and are invisible unless you
decompile the bundle — but they ship in the installer just the same, and one
of them introduces a license that appears nowhere else in the project.

| Library | License | Copyright |
| ------- | ------- | --------- |
| [entities](https://github.com/fb55/entities) | **BSD-2-Clause** | Copyright (c) Felix Böhm. All rights reserved. |
| [linkify-it](https://github.com/markdown-it/linkify-it) | MIT | Copyright (c) 2015 Vitaly Puzrin |
| [mdurl](https://github.com/markdown-it/mdurl) | MIT | Copyright (c) 2015 Vitaly Puzrin, Alex Kocharin |
| [uc.micro](https://github.com/markdown-it/uc.micro) | MIT | Copyright Mathias Bynens |
| [punycode.js](https://github.com/mathiasbynens/punycode.js) | MIT | Copyright Mathias Bynens |

`entities` is verifiable from outside: rendering `&nleqslant;` produces `⩽̸`,
which requires its full named-entity table.

(`argparse`, a declared markdown-it dependency under Python-2.0, is used only
by its command-line tooling and is **not** in the browser bundle.)

## Rust dependencies

Compiled into `glance.exe`. Filtered to the shipped target
(`x86_64-pc-windows-msvc`) and to crates that actually link into the binary —
roughly 149 crate-versions, out of 473 that appear in `Cargo.lock` across all
platforms.

| License | Notes |
| ------- | ----- |
| MIT, Apache-2.0, and dual `MIT OR Apache-2.0` | The overwhelming majority. |
| **Apache-2.0 only** | `tao` (the windowing layer) offers **no MIT alternative**, so a verbatim Apache-2.0 copy is mandatory: [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt). |
| **Unicode-3.0** | The ICU4X family (`icu_*`, `zerovec`, `tinystr`, …). Requires its notice in copies and documentation: [`licenses/Unicode-3.0.txt`](licenses/Unicode-3.0.txt). Copyright © 2020-2024 Unicode, Inc. |
| **BSD-3-Clause** | `brotli`, `brotli-decompressor`, `alloc-no-stdlib`, `alloc-stdlib` — all `Copyright (c) 2016 Dropbox, Inc.` `brotli`'s MIT half is `Copyright (c) 2009, 2010, 2013-2016 by the Brotli Authors.` |
| **MPL-2.0** | `option-ext` (via `tauri → dirs → dirs-sys`). |
| Zlib, 0BSD, Unlicense | Appear only as alternatives inside dual licenses (e.g. `Unlicense OR MIT`); this project elects MIT wherever it is offered. |

Points that matter:

- **`brotli` is `BSD-3-Clause AND MIT`, and `dpi` is `Apache-2.0 AND MIT` —
  AND, not OR.** Both licenses must be satisfied for those two crates; you
  cannot elect one.
- **MPL-2.0 (`option-ext`) is file-level copyleft and it *is* in the shipped
  binary.** This does not affect your licensing: MPL-2.0 §3.3 explicitly
  permits distributing a Larger Work under any other terms, including 0BSD.
  §3.2 does require telling recipients of the executable how to obtain that
  source, so: **the unmodified source of `option-ext` is at
  <https://crates.io/crates/option-ext> and
  <https://github.com/soc/option-ext>.** If you *modified* that crate, you
  would owe your changes to it, and nothing else.
- **`r-efi`** carries the tree's only LGPL string
  (`MIT OR Apache-2.0 OR LGPL-2.1-or-later`) and dependency scanners flag it.
  It is reached only through wasm/UEFI targets and is **not in the Windows
  dependency graph at all**; where it is used, MIT applies. Either way there
  is no LGPL obligation.
- Four MPL-2.0 crates (`cssparser`, `cssparser-macros`, `selectors`,
  `dtoa-short`) appear in `Cargo.lock` but are **not** in the Windows binary —
  they belong to the Linux WebKit path. A naive `cargo metadata` scan
  over-reports them.
- No crate is missing a license field, and there is no GPL or AGPL anywhere
  in the tree.

To regenerate this inventory mechanically:

```bash
cargo install cargo-about
cd src-tauri && cargo about generate --target x86_64-pc-windows-msvc
```

## Runtime

Glance renders through **WebView2**, which is a component of Windows and is
neither bundled nor redistributed by this project. The installer only fetches
Microsoft's official bootstrapper when the runtime is absent.

---

## License texts

The long ones live in [`licenses/`](licenses): [Apache-2.0](licenses/Apache-2.0.txt)
and [Unicode-3.0](licenses/Unicode-3.0.txt). The short ones follow.

### MIT License

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

### ISC License

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

### BSD 2-Clause License

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

### BSD 3-Clause License

```
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

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

Note on BSD-3-Clause clause 3: it is a conduct restriction rather than a
reproduction one, and it survives regardless of Glance's own license — do not
use the names of highlight.js or its contributors to endorse or promote
derived products without permission.

Full license texts for every Rust crate ship with their source on
[crates.io](https://crates.io) and are present in the local Cargo registry
cache after a build.
