# Glance

A fast, minimal reader and editor for Markdown files.

## The three views

| View | Shortcut | What it's for |
| ---- | -------- | ------------- |
| **Read** | Ctrl+3 | Rendered document only. Files opened from Explorer start here. |
| **Edit** | Ctrl+1 | Raw Markdown text only. New files start here. |
| **Split** | Ctrl+2 | Editor on the left, live preview on the right. |

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
| Ctrl+1 / 2 / 3 | Edit / Split / Read view |
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
