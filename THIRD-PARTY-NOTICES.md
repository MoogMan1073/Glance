# Third-Party Notices

Glance itself is released under the [BSD Zero Clause License](LICENSE), which
asks nothing of you — no attribution, no fee.

The libraries Glance bundles are a separate matter. They are all permissive
(nothing copyleft in the usual sense, nothing that restricts commercial use),
but most of them do ask that their copyright notice travel with copies of the
software. This file carries those notices so that redistributing Glance —
source or a compiled installer — satisfies them.

If you reuse Glance's own code without these libraries, none of this applies.

---

## Bundled JavaScript and CSS

Shipped verbatim in `src/vendor/` and inside the installer.

| Library | Version | License |
| ------- | ------- | ------- |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 14.3.0 | MIT |
| [markdown-it-footnote](https://github.com/markdown-it/markdown-it-footnote) | 4.0.0 | MIT |
| [markdown-it-deflist](https://github.com/markdown-it/markdown-it-deflist) | 3.0.1 | MIT |
| [markdown-it-mark](https://github.com/markdown-it/markdown-it-mark) | 4.0.0 | MIT |
| [markdown-it-sub](https://github.com/markdown-it/markdown-it-sub) | 2.0.0 | MIT |
| [markdown-it-sup](https://github.com/markdown-it/markdown-it-sup) | 2.0.0 | MIT |
| [markdown-it-emoji](https://github.com/markdown-it/markdown-it-emoji) | 3.0.0 | MIT |
| [markdown-it-attrs](https://github.com/arve0/markdown-it-attrs) | 4.x | MIT |
| [markdown-it-task-lists](https://github.com/revin/markdown-it-task-lists) | 2.1.0 | ISC |
| [highlight.js](https://github.com/highlightjs/highlight.js) (+ github / github-dark themes) | 11.11.1 | BSD-3-Clause |

Copyright holders:

- **markdown-it and the `markdown-it-*` plugins by that project** —
  Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.
- **markdown-it-attrs** — Copyright (c) 2016 Arve Seljebu.
- **markdown-it-task-lists** — Copyright (c) 2016 Revin Guillen.
- **highlight.js** — the distributed bundle carries the banner
  `(c) 2006-2024 Josh Goebel <hello@joshgoebel.com> and other contributors`;
  the upstream `LICENSE` file records Copyright (c) 2006 Ivan Sagalaev.
  The `github` and `github-dark` themes ship as part of highlight.js.

The full text of the MIT, ISC, and BSD-3-Clause licenses appears at the bottom
of this file.

## Rust dependencies

Compiled into the Glance executable. The dependency graph resolves to 473
packages; every one declares a license, and there is no GPL/AGPL obligation
anywhere in the tree. The licenses that appear:

| License | Notes |
| ------- | ----- |
| MIT, Apache-2.0, and dual `MIT OR Apache-2.0` | The overwhelming majority. |
| BSD-3-Clause | `brotli`, `alloc-no-stdlib`, `alloc-stdlib`, and others offering it as one option. |
| ISC, Zlib, 0BSD, Unlicense | Permissive; several offered as one option in a dual license. |
| Unicode-3.0 | The `icu_*` / `zerovec` family used for Unicode handling. |
| MPL-2.0 | `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short`, `option-ext`. |

Two of these deserve a sentence:

- **MPL-2.0** is file-level copyleft. Glance uses these crates unmodified as
  libraries, which MPL-2.0 explicitly permits inside a larger work under any
  license. The obligation is that the source of those specific files stays
  available — it is, unmodified, on crates.io. If you were to *modify* one of
  those crates, you would need to publish your changes to it (only to it).
- **`r-efi`** is offered as `MIT OR Apache-2.0 OR LGPL-2.1-or-later`. Taking it
  under MIT or Apache-2.0 — as this project does — carries no LGPL obligation.

Tauri, the application framework, is dual-licensed MIT / Apache-2.0.

To regenerate this inventory:

```bash
cd src-tauri && cargo metadata --format-version 1 | \
  python -c "import json,sys,collections; d=json.load(sys.stdin); \
  print(collections.Counter(p.get('license') for p in d['packages']))"
```

## Runtime

Glance renders through **WebView2**, which is part of Windows and is not
bundled or redistributed by this project. The installer only downloads
Microsoft's official bootstrapper if the runtime is missing.

---

## License texts

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

Full license texts for the Rust dependencies are distributed with their source
on [crates.io](https://crates.io) and in the local Cargo registry cache.
