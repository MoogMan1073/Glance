# Live preview: constraints and measurements

Working notes behind the "editable rendered view" question. Kept because the
measurements are cheap to lose and expensive to redo.

## The constraint that shapes everything

A rendered block and its raw markdown source occupy **different heights**. A
heading is bigger than `## Heading`; a wrapped paragraph rewraps at a different
column once its `**markers**` appear. So any design that swaps one for the other
in place makes the document reflow under the caret on every cursor move.

Obsidian does not have this problem because CodeMirror 6 owns the layout of both
states and reserves the space. Anything built on a `<textarea>` plus separately
rendered HTML is asking two layout engines to agree on one column of text.

## Measured: a textarea's undo stack does not survive reparenting

Probed in Chromium (the engine WebView2 uses). Type two words via
`execCommand('insertText')`, do the DOM operation, then `Ctrl+Z`:

| DOM operation | Undo still works |
| --- | --- |
| none (baseline) | **yes** — reverts to empty |
| toggle `hidden` on the textarea | **yes** |
| `appendChild` into a different parent | **no** — text unchanged |
| remove from DOM, then re-insert | **no** |

Two consequences:

- The current design is safe. Documents are separate textareas that are only
  ever shown and hidden, never moved, which is why per-tab undo history works.
- A "floating textarea that moves to whichever block is being edited" cannot
  keep native undo. Every caret move between blocks would clear the stack.
  That design's strongest claim — undo preserved for free — does not hold.

Preserving undo across a moving editor therefore means writing an undo manager,
which is a substantial piece of work and a behaviour-compatibility risk in its
own right.

## What was built, and why this shape

Four designs were worked up independently and three came back having converged
on the same architecture from opposite starting points, including the one
briefed to argue for `contenteditable`. That shape is what shipped:

> Keep the per-document textarea holding the whole document and never move it.
> Render the document as a column of blocks around it, leave a gap where the
> caret's block is, and put the textarea over that gap.

The caret is therefore never anywhere but in source text. There is no
caret-in-rendered-DOM position to map, no HTML to serialise back to Markdown,
and no undo stack to reimplement — the textarea's contract with the rest of
`app.js` is byte-for-byte what it was, which is why all 95 tests that existed
before this feature pass unmodified.

The textarea is sized to the gap and scrolled internally, rather than left at
full height and clipped. Two reasons, both measured:

- A full-height textarea (tens of thousands of pixels on a long document)
  is inside the pane's scrollable overflow and stretches its scroll range.
- Chromium keeps a programmatically-set `scrollTop` even when the caret is
  moved far outside the visible strip — `setSelectionRange` does not scroll.
  So the peephole stays pinned, and only real caret keys can disturb it.

### CodeMirror 6 was checked, not assumed

Obsidian avoids the two-layout problem because CM6 owns the layout of both
states. It cannot be borrowed here without a build step:

| Route | Result |
| --- | --- |
| jsDelivr `+esm` | 1.5 KB of network `import`s — blocked by our CSP (`script-src 'self'`) |
| esm.sh `?bundle` | Two files, 377 KB + 459 KB, each inlining its own `@codemirror/state` → CM6's duplicate-instance throw |
| `paul-norman` prebuilt IIFE | 585 KB, no `WidgetType` / `ViewPlugin` / `syntaxTree` — a highlighting build |
| `RPGillespie6` prebuilt IIFE | 415 KB, three exported functions, no Markdown language |

Vendoring CM6 properly would mean running Rollup ourselves, roughly doubling
the vendor payload in a launch-speed-first app, and adding a second Markdown
parser (Lezer) that disagrees with markdown-it about footnotes, definition
lists, `==mark==`, `^sup^`, `~sub~`, `{.attrs}` and emoji — so Live view and
Read view would render the same file differently.

### The cost, measured

Per keystroke, live view versus the same edit in Edit view, Chromium:

| Document | Blocks | Added per keystroke |
| --- | --- | --- |
| 70 lines | 59 | none measurable |
| 420 lines | 360 | none measurable |
| 2,100 lines | 1,800 | ~11 ms |
| 6,300 lines | 5,400 | ~40 ms |

Typing inside a block changes only that block, and that block is the gap —
hidden behind the editor, where nobody can see it go stale. So a keystroke
re-lays-out the hole immediately (cheap) and defers re-rendering the column by
150 ms; adding or removing a line moves every block below it and rebuilds at
once. Without that split the 2,100-line case cost ~23 ms and the cache made no
difference, because the expense is `md.parse` plus writing the whole document
into `#selMirror`, not the block rendering.

### Known limits

Measured against the built feature, not estimated.

- **Reveal is per block, not per inline range.** Putting the caret in one
  checkbox item turns the *whole list* to monospace source, where Obsidian
  would unwrap only the markers on that line. This is the largest gap from
  the original ask, and it follows from grouping on depth-0 `token.map`.
- **A document that is a single block shows no rendered text at all** — live
  view degrades to Edit view exactly for the shortest notes.
- **The open block loses its styling**: a rendered `<h1>` is 28.5px Segoe UI,
  its source is 14px Cascadia Code with the heading rule gone.
- **Content below the caret shifts on every block change**, by the difference
  between a block's rendered and source heights: about 61px entering an H1,
  30px an H2, 29px a blockquote, 25px a table, 19px a list. Content *above*
  does not move, because the gap is positioned by the flow above it — the
  reflow is one-directional, which is the part that makes this bearable.
- **Column selection is not available**; a rectangle spanning rendered blocks
  has no meaning in source terms. Alt+drag says so rather than doing nothing.
- **Click-to-caret aligns rendered text against source** by skipping the
  characters that did not survive rendering. Emoji (enabled by default here),
  footnote markers and `{.attrs}` break that assumption, so a confidence check
  drops the caret at the start of the block rather than guessing — a click in
  an emoji paragraph can land ~90 characters early.
- **Entering live view on a very large document costs**: ~620 ms on a
  5,400-block file, and block-crossing caret moves run ~70 ms there.

A dragged selection over rendered text is converted into the editor's own
selection, opening every block it touches. Without that the browser highlight
would be real while `editor.selectionStart === selectionEnd`, so Ctrl+B and
the toolbar would silently act on nothing — a failure mode with no visible
symptom until the file is saved.
