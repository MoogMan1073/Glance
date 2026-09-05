# Glance

A fast, minimal reader and editor for Markdown files.

## The four views

| View | Shortcut | What it's for |
| ---- | -------- | ------------- |
| **Read** | Ctrl+3 | Rendered document only. Files opened from Explorer start here. |
| **Edit** | Ctrl+1 | Raw Markdown text only. New files start here. |
| **Split** | Ctrl+2 | Editor on the left, live preview on the right. |
| **Live** | Ctrl+4 | Rendered *and* editable: see [Live view](#live-view). |

## Live view

The document looks the way it will read, but you can type into it. Whichever
block the cursor is in turns back into raw Markdown, so you edit the real
`## heading` or `- [ ] item` while everything around it stays rendered. Move
the cursor away and that block renders again.

- **Click anywhere** in the text to put the cursor there. The block you clicked
  opens for editing.
- **Drag across the text** to select it. The selection becomes a real editor
  selection, so bold, quote and the rest apply to it; every block it covers
  opens as source.
- **Click a checkbox** to tick it off. That edits the file — and only that —
  so the cursor and your place on the page do not move.
- **Ctrl+click a link** to open it in your browser. A plain click puts the
  cursor in the link text, so link text stays editable like everything else.
- Everything else behaves as it does in Edit view: the toolbar, the right-click
  menu, every shortcut, Enter continuing a list, and Ctrl+Z.

A "block" is one paragraph, heading, list, table, quote or code fence — the
whole thing, not one line of it. Two things live view does not do: it does not
colour the Markdown in the block you are editing, and column selection is not
available there (Ctrl+1 for Edit view, which has it). Very long documents —
a few thousand lines — start to feel the cost of laying out both forms at once;
Edit and Split views stay fast at any size.

## Tabs

Several documents stay open at once, like browser tabs. The tab bar appears
as soon as there's a second one, and each tab remembers its own text, cursor
position, and scroll place.

Opening a file that's already open just switches to it. Double-clicking a
`.md` file in Explorer adds it to this window rather than starting a second
copy of Glance.

| Shortcut | Action |
| -------- | ------ |
| Ctrl+T | New tab |
| Ctrl+W | Close tab (closes the window if it's the last one) |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+PageDown / Ctrl+PageUp | Next / previous tab |
| Alt+1 … Alt+8 | Jump to tab 1–8 |
| Alt+9 | Jump to the last tab |

Middle-clicking a tab closes it. A dot in place of the × means that
document has unsaved changes.

### Moving a document to its own window

Two ways, both ending in the same place:

- **Right-click the tab** and choose **Move to New Window**.
- **Drag the tab out** of the window and let go. The new window opens where
  you dropped it.

Unsaved text comes along, so there is nothing to save first and nothing to
confirm. A window showing only one document has nothing to move out, so the
menu item is greyed out there.

## Column selection

Hold **Alt** and drag to select a rectangle instead of a run of text, the way
Notepad++ and the code editors do.

- Drag straight down to put a **cursor on each line**, then type — the text
  appears on every one of them at once. This is the quick way to add `- `,
  `> ` or `#` to a stack of lines.
- Drag across as well as down to select a **block**. Typing replaces it on
  every line; **Backspace** or **Delete** removes it.
- **Ctrl+C** copies the rectangle, one line per row. **Ctrl+X** cuts it.
- **Ctrl+V** pastes a rectangle back line for line when the clipboard has the
  same number of lines; otherwise the same text goes on every line.
- **Ctrl+Z** undoes the whole block edit in one step, not one step per line.
- **Esc**, an arrow key, or a plain click ends the column selection.

Lines too short to reach the selected columns are left alone, so a ragged
block does not pad anything out.

Useful for markdown tables: Alt+drag down a column to fix its width or blank
it out across every row at once.

## Right-click menu

Right-clicking in the editor opens a formatting menu (in live view, right-click
inside the open block): **Format** for bold,
italic, strikethrough, highlight, code and clear-formatting; **Paragraph**
for lists, headings and quotes; **Insert** for tables, rules and images.
The Paragraph submenu ticks the style the cursor is currently in.

Cut, Copy, Paste and Select all are there too — the menu replaces the one
the system would otherwise show.

Right-clicking a tab offers to move that document to its own window, close
it, or close the others.

## Keyboard shortcuts

### Files

| Shortcut | Action |
| -------- | ------ |
| Ctrl+N | New file (new tab) |
| Ctrl+O | Open file… (select several at once) |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save As… |
| Ctrl+W | Close tab |

### Formatting

| Shortcut | Action |
| -------- | ------ |
| Ctrl+B | **Bold** |
| Ctrl+I | *Italic* |
| Ctrl+Shift+X | ~~Strikethrough~~ |
| Ctrl+Shift+H | ==Highlight== |
| Ctrl+E | `Inline code` |
| Ctrl+Shift+C | Code block |
| Ctrl+K | Link |
| Ctrl+Alt+1 … 6 | Heading level 1–6 |
| Ctrl+Alt+0 | Remove heading (plain paragraph) |
| Ctrl+Shift+8 | Bulleted list |
| Ctrl+Shift+7 | Numbered list |
| Ctrl+Shift+9 | Checkbox list |
| Ctrl+Shift+Q | Blockquote |
| Tab / Shift+Tab | Indent / outdent line or list item |

While typing in a list, **Enter** continues the list with the next bullet,
number, or checkbox. Press **Enter on an empty item** to end the list.

### View & app

| Shortcut | Action |
| -------- | ------ |
| Ctrl+1 / 2 / 3 / 4 | Edit / Split / Read / Live view |
| Ctrl+Shift+D | Cycle theme: System → Light → Dark |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+P | Print the rendered document |
| F1 | This help |

---

# Markdown Cheat Sheet

This overview is based on [The Markdown Guide](https://www.markdownguide.org).
For more detail see the guides for [basic syntax](https://www.markdownguide.org/basic-syntax/)
and [extended syntax](https://www.markdownguide.org/extended-syntax/).

## Basic Syntax

These are the elements outlined in John Gruber's original design document.
All Markdown applications support these elements.

### Heading

```markdown
# H1
## H2
### H3
```

### Bold

```markdown
**bold text**
```

**bold text**

### Italic

```markdown
*italicized text*
```

*italicized text*

### Blockquote

```markdown
> blockquote
```

> blockquote

### Ordered List

```markdown
1. First item
2. Second item
3. Third item
```

1. First item
2. Second item
3. Third item

### Unordered List

```markdown
- First item
- Second item
- Third item
```

- First item
- Second item
- Third item

### Code

```markdown
`code`
```

`code`

### Horizontal Rule

```markdown
---
```

---

### Link

```markdown
[Markdown Guide](https://www.markdownguide.org)
```

[Markdown Guide](https://www.markdownguide.org)

### Image

```markdown
![alt text](https://www.markdownguide.org/assets/images/tux.png)
```

## Extended Syntax

These elements extend the basic syntax. This app renders all of the
elements below; other Markdown applications may not support every one.

### Table

```markdown
| Syntax | Description |
| ----------- | ----------- |
| Header | Title |
| Paragraph | Text |
```

| Syntax | Description |
| ----------- | ----------- |
| Header | Title |
| Paragraph | Text |

### Fenced Code Block

````markdown
```json
{
  "firstName": "John",
  "lastName": "Smith",
  "age": 25
}
```
````

Add a language name (like `json`, `python`, `js`) right after the opening
fence to get syntax coloring.

### Footnote

```markdown
Here's a sentence with a footnote. [^1]

[^1]: This is the footnote.
```

### Heading ID

```markdown
### My Great Heading {#custom-id}
```

Link to it with `[link](#custom-id)`.

### Definition List

```markdown
term
: definition
```

term
: definition

### Strikethrough

```markdown
~~The world is flat.~~
```

~~The world is flat.~~

### Task List

```markdown
- [x] Write the press release
- [ ] Update the website
- [ ] Contact the media
```

- [x] Write the press release
- [ ] Update the website
- [ ] Contact the media

### Emoji

```markdown
That is so funny! :joy:
```

That is so funny! :joy:

### Highlight

```markdown
I need to highlight these ==very important words==.
```

I need to highlight these ==very important words==.

### Subscript

```markdown
H~2~O
```

H~2~O

### Superscript

```markdown
X^2^
```

X^2^

---

## Notes

- Images referenced by documents render in the preview: web URLs, absolute
  paths (`C:\photos\pic.png`), and paths relative to the open file
  (`![diagram](images/diagram.png)`). Relative paths need the file to be
  saved/opened from disk so there is a folder to resolve against.
- Raw HTML inside documents is shown as text, not executed — documents from
  any source are safe to open.
- Web links in the preview open in your default browser.
- The theme button cycles **System → Light → Dark**. "System" follows your
  Windows appearance setting.
