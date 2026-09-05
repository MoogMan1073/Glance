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
