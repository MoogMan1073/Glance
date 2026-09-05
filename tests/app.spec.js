// @ts-check
const { test, expect } = require('@playwright/test');

// ---------------------------------------------------------------
// A stub of the pieces of the Tauri v2 global API that app.js uses,
// so the frontend can be exercised in a plain browser.
// ---------------------------------------------------------------
function tauriStub(opts) {
  return `
    window.__TAURI_TEST__ = Object.assign({
      files: {},
      invokes: [],
      launchFile: null,
      askResponse: true,
      asks: [],
      openResponse: null,
      saveResponse: null,
      openedUrls: [],
      title: '',
      closed: false,
      listeners: {},
      askDelay: 0,
      pendingFiles: [],
      writeDelay: 0,
      newWindows: [],
      newWindowFails: false,
      handoffDoc: null,
      clipboardText: '',
    }, ${JSON.stringify(opts || {})});
    const T = () => window.__TAURI_TEST__;
    window.__TAURI__ = {
      core: {
        convertFileSrc: (p) => 'stub-asset://' + p,
        invoke: async (cmd, args) => {
          T().invokes.push([cmd, args]);
          if (cmd === 'launch_file_path') return T().launchFile;
          if (cmd === 'read_text_file') {
            if (!(args.path in T().files)) throw 'Could not open ' + args.path;
            return T().files[args.path];
          }
          if (cmd === 'write_text_file') { T().files[args.path] = args.contents; return null; }
          if (cmd === 'take_pending_files') return T().pendingFiles || [];
          if (cmd === 'take_handoff') return T().handoffDoc || null;
          if (cmd === 'open_in_new_window') {
            if (T().newWindowFails) throw 'Could not open a new window: denied';
            T().newWindows.push(args); return null;
          }
          throw new Error('unknown command ' + cmd);
        },
      },
      dialog: {
        ask: async (msg) => {
          T().asks.push(msg);
          if (T().askDelay) await new Promise((r) => setTimeout(r, T().askDelay));
          return T().askResponse;
        },
        open: async () => T().openResponse,
        save: async () => T().saveResponse,
      },
      window: {
        getCurrentWindow: () => ({
          label: T().windowLabel || 'main',
          setTitle: async (t) => { T().title = t; },
          show: async () => {},
          setFocus: async () => {},
          unminimize: async () => {},
          close: async () => { T().closed = true; },
          destroy: async () => { T().closed = true; },
          onCloseRequested: (h) => { T().closeHandler = h; },
        }),
      },
      event: {
        listen: (name, h) => { (T().listeners[name] = T().listeners[name] || []).push(h); },
      },
      webview: {
        getCurrentWebview: () => ({
          onDragDropEvent: (h) => { T().dropHandler = h; },
        }),
      },
      opener: { openUrl: async (u) => { T().openedUrls.push(u); } },
      clipboardManager: {
        readText: async () => T().clipboardText || '',
        writeText: async (t) => { T().clipboardText = t; },
      },
    };
  `;
}

async function boot(page, opts) {
  await page.addInitScript(tauriStub(opts));
  await page.goto('/index.html');
  await expect(page.locator('body')).toHaveAttribute('data-view', /edit|read|split/);
}

// Put text in the editor and select a range of it.
async function setEditor(page, text, selStart, selEnd) {
  await page.evaluate(
    ([text, s, e]) => {
      const ed = document.getElementById('editor');
      ed.value = text;
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      ed.focus();
      ed.setSelectionRange(s ?? text.length, e ?? s ?? text.length);
    },
    [text, selStart, selEnd]
  );
}

const editorValue = (page) =>
  page.evaluate(() => document.getElementById('editor').value);

// ---------------------------------------------------------------
// Startup & views
// ---------------------------------------------------------------

test('blank launch starts in edit view with Untitled title', async ({ page }) => {
  await boot(page);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'edit');
  await expect(page).toHaveTitle(/Untitled - Glance/);
});

test('launching with a file opens it in read (display) view', async ({ page }) => {
  await boot(page, {
    launchFile: 'C:\\notes\\hello.md',
    files: { 'C:\\notes\\hello.md': '# Hello World\n\nSome *notes*.' },
  });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'read');
  await expect(page.locator('#preview h1')).toHaveText('Hello World');
  await expect(page).toHaveTitle(/hello\.md - Glance/);
  // Editing tools are hidden in read view.
  await expect(page.locator('#btn-bold')).toBeHidden();
});

test('Ctrl+1/2/3 switch views and highlight the active button', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+2');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'split');
  await expect(page.locator('#btn-view-split')).toHaveClass(/active/);
  await page.keyboard.press('Control+3');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'read');
  await page.keyboard.press('Control+1');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'edit');
});

// ---------------------------------------------------------------
// Rendering — everything in the markdown cheat sheet
// ---------------------------------------------------------------

const CHEAT = [
  '# H1 {#custom-id}',
  '**bold text** and *italicized text* and ~~struck~~ and ==marked==',
  '> blockquote',
  '1. First item',
  '2. Second item',
  '- First item',
  '`code`',
  '---',
  '[Markdown Guide](https://www.markdownguide.org)',
  '| Syntax | Description |',
  '| --- | --- |',
  '| Header | Title |',
  '```json',
  '{ "firstName": "John" }',
  '```',
  "Here's a sentence with a footnote. [^1]",
  '',
  '[^1]: This is the footnote.',
  '',
  'term',
  ': definition',
  '',
  '- [x] Write the press release',
  '- [ ] Update the website',
  '',
  'That is so funny! :joy:',
  '',
  'H~2~O and X^2^',
].join('\n');

test('renders every cheat-sheet element', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+2'); // split view so the preview renders
  await setEditor(page, CHEAT);
  const p = page.locator('#preview');
  await expect(p.locator('h1#custom-id')).toHaveText('H1');
  await expect(p.locator('strong')).toHaveText('bold text');
  await expect(p.locator('em')).toHaveText('italicized text');
  await expect(p.locator('s')).toHaveText('struck');
  await expect(p.locator('mark')).toHaveText('marked');
  await expect(p.locator('blockquote')).toContainText('blockquote');
  await expect(p.locator('ol:not(.footnotes-list) li')).toHaveCount(2);
  await expect(p.locator('hr:not(.footnotes-sep)')).toHaveCount(1);
  await expect(p.locator('a[href="https://www.markdownguide.org"]')).toBeVisible();
  await expect(p.locator('table th').first()).toHaveText('Syntax');
  await expect(p.locator('pre code .hljs-attr')).toContainText('firstName'); // syntax coloring
  await expect(p.locator('.footnote-ref')).toBeVisible();
  await expect(p.locator('dl dt')).toHaveText('term');
  await expect(p.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(p.locator('input[type="checkbox"]').first()).toBeChecked();
  await expect(p).toContainText('😂'); // :joy:
  await expect(p.locator('sub')).toHaveText('2');
  await expect(p.locator('sup:not(.footnote-ref)')).toHaveText('2');
});

test('raw HTML in documents is escaped, not executed', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+2');
  await setEditor(page, 'before <img src=x onerror="document.title=\'pwned\'"> after');
  await expect(page.locator('#preview')).toContainText('<img src=x');
  await expect(page.locator('#preview img')).toHaveCount(0);
});

test('attrs plugin only allows id/class attributes', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+2');
  await setEditor(page, '# Title {onclick=alert(1) id=safe}');
  await expect(page.locator('#preview h1#safe')).toBeVisible();
  expect(await page.locator('#preview h1').getAttribute('onclick')).toBeNull();
});

test('external links open through the opener, not navigation', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+2');
  await setEditor(page, '[site](https://example.com/x)');
  await page.locator('#preview a').click();
  const urls = await page.evaluate(() => window.__TAURI_TEST__.openedUrls);
  expect(urls).toEqual(['https://example.com/x']);
  await expect(page).toHaveURL(/index\.html/); // stayed on the page
});

// ---------------------------------------------------------------
// Toolbar formatting
// ---------------------------------------------------------------

test('bold button wraps and unwraps the selection', async ({ page }) => {
  await boot(page);
  await setEditor(page, 'make me bold', 5, 7);
  await page.click('#btn-bold');
  expect(await editorValue(page)).toBe('make **me** bold');
  await page.click('#btn-bold'); // toggle off (selection is inner text)
  expect(await editorValue(page)).toBe('make me bold');
});

test('Ctrl+B / Ctrl+I / Ctrl+E hotkeys format the selection', async ({ page }) => {
  await boot(page);
  await setEditor(page, 'word', 0, 4);
  await page.keyboard.press('Control+b');
  expect(await editorValue(page)).toBe('**word**');
  await setEditor(page, 'word', 0, 4);
  await page.keyboard.press('Control+i');
  expect(await editorValue(page)).toBe('*word*');
  await setEditor(page, 'word', 0, 4);
  await page.keyboard.press('Control+e');
  expect(await editorValue(page)).toBe('`word`');
});

test('heading dropdown and Ctrl+Alt+N set heading levels', async ({ page }) => {
  await boot(page);
  await setEditor(page, 'My Title', 2, 2);
  await page.selectOption('#sel-heading', '2');
  expect(await editorValue(page)).toBe('## My Title');
  await page.keyboard.press('Control+Alt+5');
  expect(await editorValue(page)).toBe('##### My Title');
  await page.keyboard.press('Control+Alt+0');
  expect(await editorValue(page)).toBe('My Title');
});

test('list buttons toggle bullets, numbers, and checkboxes over multiple lines', async ({ page }) => {
  await boot(page);
  await setEditor(page, 'alpha\nbeta\ngamma', 0, 16);
  await page.click('#btn-ul');
  expect(await editorValue(page)).toBe('- alpha\n- beta\n- gamma');
  await page.click('#btn-ol');
  expect(await editorValue(page)).toBe('1. alpha\n2. beta\n3. gamma');
  await page.click('#btn-task');
  expect(await editorValue(page)).toBe('- [ ] alpha\n- [ ] beta\n- [ ] gamma');
  await page.click('#btn-task'); // toggle off
  expect(await editorValue(page)).toBe('alpha\nbeta\ngamma');
});

test('quote button toggles blockquote markers', async ({ page }) => {
  await boot(page);
  await setEditor(page, 'a quote line', 3, 3);
  await page.click('#btn-quote');
  expect(await editorValue(page)).toBe('> a quote line');
  await page.click('#btn-quote');
  expect(await editorValue(page)).toBe('a quote line');
});

test('link button wraps selected text and selects the url slot', async ({ page }) => {
  await boot(page);
  await setEditor(page, 'Markdown Guide', 0, 14);
  await page.click('#btn-link');
  expect(await editorValue(page)).toBe('[Markdown Guide](url)');
  const sel = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    return ed.value.slice(ed.selectionStart, ed.selectionEnd);
  });
  expect(sel).toBe('url');
});

test('code block button fences the selection', async ({ page }) => {
  await boot(page);
  await setEditor(page, 'let x = 1;', 0, 10);
  await page.click('#btn-codeblock');
  expect(await editorValue(page)).toBe('```\nlet x = 1;\n```');
});

test('hr under a paragraph gets a blank line so it does not become a setext heading', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+2');
  await setEditor(page, 'above', 5, 5);
  await page.click('#btn-hr');
  expect(await editorValue(page)).toBe('above\n\n---\n');
  await expect(page.locator('#preview hr')).toHaveCount(1);
  await expect(page.locator('#preview h2')).toHaveCount(0);
  await page.click('#btn-table');
  expect(await editorValue(page)).toContain('| Column 1 | Column 2 |');
});

test('indenting with a collapsed caret keeps the caret collapsed', async ({ page }) => {
  await boot(page);
  await setEditor(page, '- item', 6, 6);
  await page.keyboard.press('Tab');
  expect(await editorValue(page)).toBe('  - item');
  await page.keyboard.type('s'); // must append, not replace a selected line
  expect(await editorValue(page)).toBe('  - items');
});

test('Ctrl+I on a word inside bold adds italic instead of destroying bold', async ({ page }) => {
  await boot(page);
  await setEditor(page, 'a **bold** b', 4, 8); // "bold" selected inside the stars
  await page.keyboard.press('Control+i');
  expect(await editorValue(page)).toBe('a ***bold*** b');
  await page.keyboard.press('Control+i'); // and back off again
  expect(await editorValue(page)).toBe('a **bold** b');
});

test('Enter just after a list marker splits the item instead of deleting the marker', async ({ page }) => {
  await boot(page);
  await setEditor(page, '- item two', 2, 2); // caret between "- " and "item"
  await page.keyboard.press('Enter');
  expect(await editorValue(page)).toBe('- \n- item two');
});

// ---------------------------------------------------------------
// Smart editing
// ---------------------------------------------------------------

test('Enter continues lists and exits on an empty item', async ({ page }) => {
  await boot(page);
  await setEditor(page, '- first');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  expect(await editorValue(page)).toBe('- first\n- second');
  await page.keyboard.press('Enter'); // makes an empty "- " item
  await page.keyboard.press('Enter'); // exits the list
  expect(await editorValue(page)).toBe('- first\n- second\n');
});

test('Enter increments numbered lists and continues checkboxes', async ({ page }) => {
  await boot(page);
  await setEditor(page, '3. third');
  await page.keyboard.press('Enter');
  expect(await editorValue(page)).toBe('3. third\n4. ');
  await setEditor(page, '- [x] done');
  await page.keyboard.press('Enter');
  expect(await editorValue(page)).toBe('- [x] done\n- [ ] ');
});

test('Tab indents and Shift+Tab outdents', async ({ page }) => {
  await boot(page);
  await setEditor(page, '- item', 6, 6);
  await page.keyboard.press('Tab');
  expect(await editorValue(page)).toBe('  - item');
  await page.keyboard.press('Shift+Tab');
  expect(await editorValue(page)).toBe('- item');
});

test('toolbar edits keep the native undo stack working', async ({ page }) => {
  await boot(page);
  await setEditor(page, 'undo me', 0, 7);
  await page.click('#btn-bold');
  expect(await editorValue(page)).toBe('**undo me**');
  await page.keyboard.press('Control+z');
  expect(await editorValue(page)).toBe('undo me');
});

// ---------------------------------------------------------------
// Files
// ---------------------------------------------------------------

test('save with no path goes through Save As and writes the file', async ({ page }) => {
  await boot(page, { saveResponse: 'C:\\out\\new.md' });
  await setEditor(page, '# fresh');
  await page.keyboard.press('Control+s');
  await expect(page).toHaveTitle(/^new\.md - Glance/);
  const files = await page.evaluate(() => window.__TAURI_TEST__.files);
  expect(files['C:\\out\\new.md']).toBe('# fresh');
});

test('save-as appends .md when no extension is given', async ({ page }) => {
  await boot(page, { saveResponse: 'C:\\out\\noext' });
  await setEditor(page, 'x');
  await page.keyboard.press('Control+Shift+s');
  const files = await page.evaluate(() => window.__TAURI_TEST__.files);
  expect(Object.keys(files)).toEqual(['C:\\out\\noext.md']);
});

test('open loads the picked file and clears the dirty marker', async ({ page }) => {
  await boot(page, {
    openResponse: 'C:\\docs\\a.md',
    files: { 'C:\\docs\\a.md': '# Doc A' },
  });
  await page.keyboard.press('Control+o');
  await expect(page).toHaveTitle(/^a\.md - Glance/);
  expect(await editorValue(page)).toBe('# Doc A');
});

test('opening a file never discards unsaved work — it opens another tab', async ({ page }) => {
  await boot(page, { openResponse: 'C:\\docs\\b.md', files: { 'C:\\docs\\b.md': 'B' } });
  await setEditor(page, 'unsaved work');
  await expect(page).toHaveTitle(/^● Untitled/);
  await page.keyboard.press('Control+o');
  // The new file gets its own tab; the dirty draft survives untouched and
  // nothing had to be asked.
  await expect(page.locator('.tab')).toHaveCount(2);
  expect(await editorValue(page)).toBe('B');
  expect(await page.evaluate(() => window.__TAURI_TEST__.asks.length)).toBe(0);
  await page.locator('.tab').first().click();
  expect(await editorValue(page)).toBe('unsaved work');
});

test('close request with unsaved changes is blocked when declined', async ({ page }) => {
  await boot(page, { askResponse: false });
  await setEditor(page, 'unsaved');
  const prevented = await page.evaluate(async () => {
    let prevented = false;
    await window.__TAURI_TEST__.closeHandler({ preventDefault: () => { prevented = true; } });
    return prevented;
  });
  expect(prevented).toBe(true);
});

test('dropping a markdown file opens it', async ({ page }) => {
  await boot(page, { files: { 'C:\\drop\\d.md': '# Dropped' } });
  await page.evaluate(() =>
    window.__TAURI_TEST__.dropHandler({ payload: { type: 'drop', paths: ['C:\\drop\\d.md'] } })
  );
  await expect(page).toHaveTitle(/^d\.md/);
});

// ---------------------------------------------------------------
// Theme & help
// ---------------------------------------------------------------

test('theme cycles system → light → dark and persists', async ({ page }) => {
  await boot(page);
  const theme = () => page.evaluate(() => document.body.dataset.theme);
  await page.keyboard.press('Control+Shift+d'); // system -> light
  expect(await theme()).toBe('light');
  await page.keyboard.press('Control+Shift+d'); // light -> dark
  expect(await theme()).toBe('dark');
  expect(await page.evaluate(() => localStorage.getItem('smr-theme'))).toBe('dark');
  await page.reload();
  expect(await theme()).toBe('dark');
});

test('F1 opens help with the cheat sheet and shortcuts; Esc closes it', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('F1');
  await expect(page.locator('#helpOverlay')).toBeVisible();
  await expect(page.locator('#helpContent')).toContainText('Markdown Cheat Sheet');
  await expect(page.locator('#helpContent')).toContainText('Ctrl+Shift+8');
  await page.keyboard.press('Escape');
  await expect(page.locator('#helpOverlay')).toBeHidden();
});

test('F5, Ctrl+R and Ctrl+Shift+R are suppressed so the document survives', async ({ page }) => {
  await boot(page);
  await setEditor(page, 'do not lose me');
  await page.keyboard.press('F5');
  await page.keyboard.press('Control+r');
  await page.keyboard.press('Control+Shift+r');
  expect(await editorValue(page)).toBe('do not lose me');
});

test('AltGr combos (Ctrl+Alt on Windows) never trigger heading shortcuts', async ({ page }) => {
  await boot(page);
  await setEditor(page, 'plain text', 5, 5);
  // AltGr+3 on an AZERTY layout arrives as ctrl+alt+Digit3 with AltGraph set.
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: '#', code: 'Digit3', ctrlKey: true, altKey: true,
      modifierAltGraph: true, bubbles: true, cancelable: true,
    }));
  });
  expect(await editorValue(page)).toBe('plain text'); // no '### ' prepended
});

test('an unreadable launch file falls back to edit view, not a blank read view', async ({ page }) => {
  await boot(page, { launchFile: 'C:\\gone\\missing.md', files: {} });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'edit');
  await expect(page.locator('#toast')).toContainText('Could not open');
});

// ---------------------------------------------------------------
// Local image rendering
// ---------------------------------------------------------------

test('relative and absolute image paths resolve through the asset protocol', async ({ page }) => {
  await boot(page, {
    launchFile: 'C:\\notes\\hello.md',
    files: {
      'C:\\notes\\hello.md':
        '![rel](images/pic.png)\n\n![abs](C:\\pics\\a.png)\n\n![web](https://example.com/i.png)',
    },
  });
  const imgs = page.locator('#preview img');
  await expect(imgs).toHaveCount(3);
  expect(await imgs.nth(0).getAttribute('src')).toBe('stub-asset://C:\\notes/images/pic.png');
  expect(await imgs.nth(1).getAttribute('src')).toBe('stub-asset://C:\\pics\\a.png');
  expect(await imgs.nth(2).getAttribute('src')).toBe('https://example.com/i.png');
});

test('relative image paths in an unsaved document are left alone', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+2');
  await setEditor(page, '![rel](images/pic.png)');
  expect(await page.locator('#preview img').getAttribute('src')).toBe('images/pic.png');
});

// ---------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------

const tabNames = (page) =>
  page.locator('.tab .tab-name').allTextContents();

test('the tab bar stays hidden until a second document is open', async ({ page }) => {
  await boot(page);
  await expect(page.locator('body')).toHaveAttribute('data-tabs', 'single');
  await expect(page.locator('#tabbar')).toBeHidden();
  await page.keyboard.press('Control+t');
  await expect(page.locator('body')).toHaveAttribute('data-tabs', 'many');
  await expect(page.locator('#tabbar')).toBeVisible();
});

test('opening several files at once gives each its own tab', async ({ page }) => {
  await boot(page, {
    openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md', 'C:\\d\\c.md'],
    files: { 'C:\\d\\a.md': '# A', 'C:\\d\\b.md': '# B', 'C:\\d\\c.md': '# C' },
  });
  await page.keyboard.press('Control+o');
  await expect(page.locator('.tab')).toHaveCount(3);
  expect(await tabNames(page)).toEqual(['a.md', 'b.md', 'c.md']);
  // The blank Untitled placeholder was reused rather than left behind.
  expect(await editorValue(page)).toBe('# C');
});

test('each tab keeps its own text, caret and dirty state', async ({ page }) => {
  await boot(page, {
    openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md'],
    files: { 'C:\\d\\a.md': 'alpha', 'C:\\d\\b.md': 'beta' },
  });
  await page.keyboard.press('Control+o');
  await page.locator('.tab').first().click();
  await setEditor(page, 'alpha edited', 5, 5);
  await expect(page.locator('.tab').first()).toHaveAttribute('data-dirty', 'true');

  await page.locator('.tab').nth(1).click();
  expect(await editorValue(page)).toBe('beta');
  await expect(page.locator('.tab').nth(1)).toHaveAttribute('data-dirty', 'false');

  await page.locator('.tab').first().click();
  expect(await editorValue(page)).toBe('alpha edited');
  const caret = await page.evaluate(() => document.getElementById('editor').selectionStart);
  expect(caret).toBe(5);
});

test('opening an already-open file switches to its tab instead of duplicating', async ({ page }) => {
  await boot(page, {
    openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md'],
    files: { 'C:\\d\\a.md': 'A', 'C:\\d\\b.md': 'B' },
  });
  await page.keyboard.press('Control+o');
  await expect(page.locator('.tab')).toHaveCount(2);
  await page.evaluate(() => { window.__TAURI_TEST__.openResponse = 'C:\\d\\a.md'; });
  await page.keyboard.press('Control+o');
  await expect(page.locator('.tab')).toHaveCount(2);   // no third tab
  expect(await editorValue(page)).toBe('A');           // switched to it
});

test('Ctrl+Tab cycles forward and Ctrl+Shift+Tab back, wrapping around', async ({ page }) => {
  await boot(page, {
    openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md', 'C:\\d\\c.md'],
    files: { 'C:\\d\\a.md': 'A', 'C:\\d\\b.md': 'B', 'C:\\d\\c.md': 'C' },
  });
  await page.keyboard.press('Control+o');
  expect(await editorValue(page)).toBe('C');
  await page.keyboard.press('Control+Tab');            // wraps to first
  expect(await editorValue(page)).toBe('A');
  await page.keyboard.press('Control+Tab');
  expect(await editorValue(page)).toBe('B');
  await page.keyboard.press('Control+Shift+Tab');
  expect(await editorValue(page)).toBe('A');
  await page.keyboard.press('Control+Shift+Tab');      // wraps back to last
  expect(await editorValue(page)).toBe('C');
});

test('Alt+N jumps to tab N and Alt+9 to the last one', async ({ page }) => {
  await boot(page, {
    openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md', 'C:\\d\\c.md'],
    files: { 'C:\\d\\a.md': 'A', 'C:\\d\\b.md': 'B', 'C:\\d\\c.md': 'C' },
  });
  await page.keyboard.press('Control+o');
  await page.keyboard.press('Alt+2');
  expect(await editorValue(page)).toBe('B');
  await page.keyboard.press('Alt+9');   // last, not ninth
  expect(await editorValue(page)).toBe('C');
  await page.keyboard.press('Alt+1');
  expect(await editorValue(page)).toBe('A');
});

test('Ctrl+1/2/3 still switch views when several tabs are open', async ({ page }) => {
  await boot(page, {
    openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md'],
    files: { 'C:\\d\\a.md': 'A', 'C:\\d\\b.md': 'B' },
  });
  await page.keyboard.press('Control+o');
  await page.keyboard.press('Control+3');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'read');
  expect(await editorValue(page)).toBe('B');  // did not change tab
  await page.keyboard.press('Control+1');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'edit');
});

test('closing a clean tab activates a neighbour; the close button works', async ({ page }) => {
  await boot(page, {
    openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md', 'C:\\d\\c.md'],
    files: { 'C:\\d\\a.md': 'A', 'C:\\d\\b.md': 'B', 'C:\\d\\c.md': 'C' },
  });
  await page.keyboard.press('Control+o');
  await page.locator('.tab').nth(1).locator('.tab-close').click();
  await expect(page.locator('.tab')).toHaveCount(2);
  expect(await tabNames(page)).toEqual(['a.md', 'c.md']);
  await page.keyboard.press('Control+w');   // closes the active one (c.md)
  await expect(page.locator('.tab')).toHaveCount(1);
  expect(await editorValue(page)).toBe('A');
});

test('closing a dirty tab asks first and keeps it when declined', async ({ page }) => {
  await boot(page, {
    askResponse: false,
    openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md'],
    files: { 'C:\\d\\a.md': 'A', 'C:\\d\\b.md': 'B' },
  });
  await page.keyboard.press('Control+o');
  await setEditor(page, 'edited B');
  await page.keyboard.press('Control+w');
  await expect(page.locator('.tab')).toHaveCount(2);   // still there
  expect(await editorValue(page)).toBe('edited B');
  const asks = await page.evaluate(() => window.__TAURI_TEST__.asks);
  expect(asks[0]).toContain('b.md');
});

test('closing the last tab closes the window', async ({ page }) => {
  await boot(page, { launchFile: 'C:\\d\\a.md', files: { 'C:\\d\\a.md': 'A' } });
  await page.keyboard.press('Control+w');
  expect(await page.evaluate(() => window.__TAURI_TEST__.closed)).toBe(true);
});

test('the close prompt names how many documents are unsaved', async ({ page }) => {
  await boot(page, {
    askResponse: false,
    openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md'],
    files: { 'C:\\d\\a.md': 'A', 'C:\\d\\b.md': 'B' },
  });
  await page.keyboard.press('Control+o');
  await setEditor(page, 'dirty B');
  await page.locator('.tab').first().click();
  await setEditor(page, 'dirty A');
  await page.evaluate(async () => {
    await window.__TAURI_TEST__.closeHandler({ preventDefault: () => {} });
  });
  const asks = await page.evaluate(() => window.__TAURI_TEST__.asks);
  expect(asks[asks.length - 1]).toContain('2 documents');
});

test('a second launch opens its file as a new tab in this window', async ({ page }) => {
  await boot(page, {
    launchFile: 'C:\\d\\a.md',
    files: { 'C:\\d\\a.md': 'A', 'C:\\d\\second.md': '# Second' },
  });
  await expect(page.locator('.tab')).toHaveCount(1);
  await page.evaluate(async () => {
    for (const h of window.__TAURI_TEST__.listeners['open-file'] || []) {
      await h({ payload: 'C:\\d\\second.md' });
    }
  });
  await expect(page.locator('.tab')).toHaveCount(2);
  await expect(page).toHaveTitle(/^second\.md/);
  await expect(page.locator('#preview h1')).toHaveText('Second');
});

test('dropping several files opens them all as tabs', async ({ page }) => {
  await boot(page, { files: { 'C:\\d\\x.md': 'X', 'C:\\d\\y.md': 'Y' } });
  await page.evaluate(async () => {
    await window.__TAURI_TEST__.dropHandler({
      payload: { type: 'drop', paths: ['C:\\d\\x.md', 'C:\\d\\y.md', 'C:\\d\\skip.png'] },
    });
  });
  await expect(page.locator('.tab')).toHaveCount(2);
  expect(await tabNames(page)).toEqual(['x.md', 'y.md']);
});

test('saving an untitled tab renames it', async ({ page }) => {
  await boot(page, { saveResponse: 'C:\\out\\named.md' });
  await page.keyboard.press('Control+t');
  await setEditor(page, '# named');
  await page.keyboard.press('Control+s');
  await expect(page).toHaveTitle(/^named\.md - Glance/);
  expect(await tabNames(page)).toContain('named.md');
});

test('each tab resolves relative images against its own folder', async ({ page }) => {
  await boot(page, {
    openResponse: ['C:\\one\\a.md', 'C:\\two\\b.md'],
    files: { 'C:\\one\\a.md': '![p](img/p.png)', 'C:\\two\\b.md': '![p](img/p.png)' },
  });
  await page.keyboard.press('Control+o');
  await page.keyboard.press('Control+3');
  expect(await page.locator('#preview img').getAttribute('src')).toBe('stub-asset://C:\\two/img/p.png');
  await page.locator('.tab').first().click();
  expect(await page.locator('#preview img').getAttribute('src')).toBe('stub-asset://C:\\one/img/p.png');
});

test('a second close request while the prompt is open cannot delete another tab', async ({ page }) => {
  // The confirmation dialog stays up for as long as the user takes to answer.
  // A stalled UI can queue two clicks on the same X; the second must not
  // splice a stale index and take an unrelated document with it.
  await boot(page, {
    askDelay: 200,
    askResponse: true,
    openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md', 'C:\\d\\c.md'],
    files: { 'C:\\d\\a.md': 'A', 'C:\\d\\b.md': 'B', 'C:\\d\\c.md': 'C' },
  });
  await page.keyboard.press('Control+o');
  await setEditor(page, 'C precious unsaved');      // c.md dirty
  await page.locator('.tab').nth(1).click();
  await setEditor(page, 'B dirty');                 // b.md dirty

  // Two clicks land on b.md's X before the first prompt resolves.
  await page.evaluate(() => {
    const x = document.querySelectorAll('.tab')[1].querySelector('.tab-close');
    x.click();
    x.click();
  });
  await page.waitForTimeout(600);

  expect(await tabNames(page)).toEqual(['a.md', 'c.md']);
  // Only one prompt, and c.md kept its unsaved text.
  expect(await page.evaluate(() => window.__TAURI_TEST__.asks.length)).toBe(1);
  await page.locator('.tab').nth(1).click();
  expect(await editorValue(page)).toBe('C precious unsaved');
});

test('holding Ctrl+W does not close a tab per key repeat', async ({ page }) => {
  await boot(page, {
    openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md', 'C:\\d\\c.md'],
    files: { 'C:\\d\\a.md': 'A', 'C:\\d\\b.md': 'B', 'C:\\d\\c.md': 'C' },
  });
  await page.keyboard.press('Control+o');
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'w', code: 'KeyW', ctrlKey: true, repeat: i > 0,
        bubbles: true, cancelable: true,
      }));
    }
  });
  await page.waitForTimeout(200);
  await expect(page.locator('.tab')).toHaveCount(2); // exactly one closed
});

// ---------------------------------------------------------------
// Tab state integrity (regressions found in review)
// ---------------------------------------------------------------

const twoDocs = {
  openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md'],
  files: { 'C:\\d\\a.md': '# AAA\n\nText from a.', 'C:\\d\\b.md': '# BBB\n\nText from b.' },
};

test('returning to Read view shows the active tab, not the last one rendered', async ({ page }) => {
  await boot(page, twoDocs);
  await page.keyboard.press('Control+o');       // a and b open, b active
  await page.keyboard.press('Control+2');       // split renders b
  await page.locator('.tab').first().click();   // renders a
  await page.keyboard.press('Control+1');       // edit view — preview DOM keeps a
  await page.locator('.tab').nth(1).click();    // back to b; preview not touched
  await page.keyboard.press('Control+3');       // read view: must re-render b
  await expect(page.locator('#preview h1')).toHaveText('BBB');
});

test('undo survives switching away from a tab and back', async ({ page }) => {
  await boot(page, twoDocs);
  await page.keyboard.press('Control+o');
  await page.locator('.tab').first().click();
  await page.locator('#editor').click();
  await page.keyboard.type('ZZZ');
  expect(await editorValue(page)).toContain('ZZZ');
  await page.locator('.tab').nth(1).click();    // away
  await page.locator('.tab').first().click();   // and back
  await page.keyboard.press('Control+z');
  expect(await editorValue(page)).not.toContain('ZZZ');
});

test('each tab keeps its editor scroll position', async ({ page }) => {
  const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
  await boot(page, {
    openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md'],
    files: { 'C:\\d\\a.md': long, 'C:\\d\\b.md': long },
  });
  await page.keyboard.press('Control+o');
  await page.locator('.tab').first().click();
  await page.evaluate(() => { document.getElementById('editor').scrollTop = 900; });
  const before = await page.evaluate(() => document.getElementById('editor').scrollTop);
  expect(before).toBeGreaterThan(0);
  await page.locator('.tab').nth(1).click();
  await page.locator('.tab').first().click();
  expect(await page.evaluate(() => document.getElementById('editor').scrollTop)).toBe(before);
});

test('typing during a slow save is not marked as saved', async ({ page }) => {
  await boot(page, { writeDelay: 250, saveResponse: 'C:\\out\\s.md' });
  await setEditor(page, 'hello');
  await page.keyboard.press('Control+s');
  await setEditor(page, 'hello world');        // typed while the write is in flight
  await page.waitForTimeout(500);
  expect(await editorValue(page)).toBe('hello world');
  await expect(page).toHaveTitle(/^● /);        // still dirty
  expect(await page.evaluate(() => window.__TAURI_TEST__.files['C:\\out\\s.md'])).toBe('hello');
});

test('Save As onto a file open in another tab is refused', async ({ page }) => {
  await boot(page, twoDocs);
  await page.keyboard.press('Control+o');
  await page.evaluate(() => { window.__TAURI_TEST__.saveResponse = 'C:\\d\\a.md'; });
  await setEditor(page, 'clobber');
  await page.keyboard.press('Control+Shift+s');
  await expect(page.locator('#toast')).toContainText('already open');
  // a.md on disk is untouched and no third tab appeared.
  expect(await page.evaluate(() => window.__TAURI_TEST__.files['C:\\d\\a.md'])).toContain('AAA');
  await expect(page.locator('.tab')).toHaveCount(2);
});

test('help is properly modal: typing and shortcuts do not reach the document', async ({ page }) => {
  await boot(page, twoDocs);
  await page.keyboard.press('Control+o');
  await setEditor(page, 'untouched');
  await page.keyboard.press('F1');
  await expect(page.locator('#helpOverlay')).toBeVisible();
  await page.keyboard.type('XYZ');
  await page.keyboard.press('Control+w');       // must not close a tab
  await page.keyboard.press('Alt+1');           // must not switch tabs
  expect(await editorValue(page)).toBe('untouched');
  await expect(page.locator('.tab')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#helpOverlay')).toBeHidden();
});

test('Read view focuses the reading pane so it can be scrolled by keyboard', async ({ page }) => {
  await boot(page, { launchFile: 'C:\\d\\a.md', files: { 'C:\\d\\a.md': '# A' } });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'read');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('previewPane');
});

test('files queued before the listener existed are drained at startup', async ({ page }) => {
  await boot(page, {
    launchFile: 'C:\\d\\a.md',
    pendingFiles: ['C:\\d\\late.md'],
    files: { 'C:\\d\\a.md': '# A', 'C:\\d\\late.md': '# Late' },
  });
  await expect(page.locator('.tab')).toHaveCount(2);
  await expect(page).toHaveTitle(/^late\.md/);
});

// ---------------------------------------------------------------
// Moving a document to its own window
// ---------------------------------------------------------------

const newWindows = (page) => page.evaluate(() => window.__TAURI_TEST__.newWindows);

test('right-clicking a tab offers to move it to a new window', async ({ page }) => {
  await boot(page, twoDocs);
  await page.keyboard.press('Control+o');
  await page.locator('.tab').first().click({ button: 'right' });
  await expect(page.locator('#ctxMenu')).toBeVisible();
  await expect(page.locator('#ctxMenu .menu-item').first()).toHaveText('Move to New Window');
});

test('the context menu moves the document out and closes its tab', async ({ page }) => {
  await boot(page, twoDocs);
  await page.keyboard.press('Control+o');
  await page.locator('.tab').first().click({ button: 'right' });
  await page.locator('#ctxMenu .menu-item', { hasText: 'Move to New Window' }).click();
  await expect(page.locator('.tab')).toHaveCount(1);
  const wins = await newWindows(page);
  expect(wins).toHaveLength(1);
  expect(wins[0].doc.path).toBe('C:\\d\\a.md');
  expect(wins[0].doc.content).toContain('AAA');
  // The document that stayed behind is untouched.
  expect(await editorValue(page)).toContain('BBB');
});

test('unsaved text travels to the new window', async ({ page }) => {
  await boot(page, twoDocs);
  await page.keyboard.press('Control+o');
  await setEditor(page, '# BBB edited but never saved');
  await page.locator('.tab').nth(1).click({ button: 'right' });
  await page.locator('#ctxMenu .menu-item', { hasText: 'Move to New Window' }).click();
  const wins = await newWindows(page);
  expect(wins[0].doc.content).toBe('# BBB edited but never saved');
  expect(wins[0].doc.saved).toContain('BBB');       // the on-disk text
  expect(wins[0].doc.content).not.toBe(wins[0].doc.saved);  // i.e. still dirty
});

test('moving out never prompts, because nothing is being discarded', async ({ page }) => {
  await boot(page, { ...twoDocs, askResponse: false });
  await page.keyboard.press('Control+o');
  await setEditor(page, 'dirty');
  await page.locator('.tab').nth(1).click({ button: 'right' });
  await page.locator('#ctxMenu .menu-item', { hasText: 'Move to New Window' }).click();
  await expect(page.locator('.tab')).toHaveCount(1);
  expect(await page.evaluate(() => window.__TAURI_TEST__.asks.length)).toBe(0);
});

test('a lone document cannot be moved out — it already has its own window', async ({ page }) => {
  await boot(page, { launchFile: 'C:\\d\\a.md', files: { 'C:\\d\\a.md': 'A' } });
  await page.evaluate(() => {
    document.body.dataset.tabs = 'many';           // reveal the strip for the test
    document.getElementById('tabbar').hidden = false;
  });
  await page.locator('.tab').first().click({ button: 'right' });
  await expect(page.locator('#ctxMenu .menu-item').first()).toBeDisabled();
});

test('the tab stays put if the new window cannot be created', async ({ page }) => {
  await boot(page, { ...twoDocs, newWindowFails: true });
  await page.keyboard.press('Control+o');
  await page.locator('.tab').first().click({ button: 'right' });
  await page.locator('#ctxMenu .menu-item', { hasText: 'Move to New Window' }).click();
  await expect(page.locator('#toast')).toContainText('Could not open a new window');
  await expect(page.locator('.tab')).toHaveCount(2);   // nothing lost
});

test('dragging a tab beyond the window edge moves it to a new window', async ({ page }) => {
  await boot(page, twoDocs);
  await page.keyboard.press('Control+o');
  const tab = page.locator('.tab').first();
  const box = await tab.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 40, { steps: 4 });
  // Release past the right edge of the viewport.
  const size = page.viewportSize();
  await page.mouse.move(size.width + 80, 200, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.tab')).toHaveCount(1);
  const wins = await newWindows(page);
  expect(wins).toHaveLength(1);
  expect(wins[0].doc.path).toBe('C:\\d\\a.md');
});

test('dragging a tab within the window just activates it, no new window', async ({ page }) => {
  await boot(page, twoDocs);
  await page.keyboard.press('Control+o');
  const tab = page.locator('.tab').first();
  const box = await tab.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 200, { steps: 5 });  // into the document area
  await page.mouse.up();
  await expect(page.locator('.tab')).toHaveCount(2);
  expect(await newWindows(page)).toHaveLength(0);
});

test('a window opened by tear-off shows the document it was handed', async ({ page }) => {
  await page.addInitScript(tauriStub({
    launchFile: 'C:\\d\\ignored.md',
    files: { 'C:\\d\\ignored.md': '# Should not be opened' },
    handoffDoc: { path: 'C:\\d\\moved.md', content: '# Moved here', saved: '# Moved here' },
  }));
  await page.goto('/index.html');
  await expect(page).toHaveTitle(/^moved\.md - Glance/);
  await expect(page.locator('.tab')).toHaveCount(1);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'read');
  await expect(page.locator('#preview h1')).toHaveText('Moved here');
});

test('a non-main window never re-reads the launch arguments', async ({ page }) => {
  await page.addInitScript(tauriStub({
    windowLabel: 'win-3',
    launchFile: 'C:\\d\\original.md',
    files: { 'C:\\d\\original.md': '# Original launch file' },
  }));
  await page.goto('/index.html');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'edit');
  await expect(page).toHaveTitle(/^Untitled/);   // argv file was not opened
  const cmds = await page.evaluate(() =>
    window.__TAURI_TEST__.invokes.map((i) => i[0]));
  expect(cmds).not.toContain('launch_file_path');
});

test('a torn-off document that was dirty arrives dirty, in edit view', async ({ page }) => {
  await page.addInitScript(tauriStub({
    handoffDoc: { path: 'C:\\d\\m.md', content: 'edited', saved: 'original' },
  }));
  await page.goto('/index.html');
  await expect(page).toHaveTitle(/^● m\.md/);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'edit');
  expect(await editorValue(page)).toBe('edited');
});

// ---------------------------------------------------------------
// Column (block) selection — Alt+drag
// ---------------------------------------------------------------

// Character geometry of the live editor, so drags can target a line/column
// without the test knowing anything about the implementation.
async function editorGeometry(page) {
  return page.evaluate(() => {
    const ta = document.getElementById('editor');
    const cs = getComputedStyle(ta);
    const span = document.createElement('span');
    span.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    span.style.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
    span.textContent = '0'.repeat(20);
    document.body.appendChild(span);
    const charW = span.getBoundingClientRect().width / 20;
    span.remove();
    const r = ta.getBoundingClientRect();
    return {
      x0: r.left + parseFloat(cs.paddingLeft),
      y0: r.top + parseFloat(cs.paddingTop),
      charW,
      lineH: parseFloat(cs.lineHeight),
    };
  });
}

const cell = (g, line, col) => ({
  x: g.x0 + col * g.charW + g.charW * 0.25,
  y: g.y0 + line * g.lineH + g.lineH * 0.5,
});

async function altDrag(page, from, to) {
  const g = await editorGeometry(page);
  const a = cell(g, from[0], from[1]);
  const b = cell(g, to[0], to[1]);
  await page.keyboard.down('Alt');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
}

const GRID = 'alpha one\nbravo two\ncharlie 3\ndelta four';

async function bootEditor(page, text) {
  await boot(page);
  await page.keyboard.press('Control+1');
  await setEditor(page, text || GRID, 0, 0);
  await page.locator('#editor').click();
  return page;
}

test('Alt+drag down a column shows a caret on each line', async ({ page }) => {
  await bootEditor(page);
  await altDrag(page, [0, 0], [2, 0]);
  await expect(page.locator('#selOverlay .block-caret')).toHaveCount(3);
  await expect(page.locator('#selOverlay .block-rect')).toHaveCount(0);
});

test('typing with a zero-width column inserts on every selected line', async ({ page }) => {
  await bootEditor(page);
  await altDrag(page, [0, 0], [2, 0]);
  await page.keyboard.type('- ');
  expect(await editorValue(page)).toBe('- alpha one\n- bravo two\n- charlie 3\ndelta four');
});

test('one keystroke across many lines undoes in a single step', async ({ page }) => {
  await bootEditor(page);
  await altDrag(page, [0, 0], [3, 0]);
  await page.keyboard.type('>');            // one keystroke, four lines changed
  expect(await editorValue(page)).toBe('>alpha one\n>bravo two\n>charlie 3\n>delta four');
  await page.keyboard.press('Control+z');   // and one undo takes all four back
  expect(await editorValue(page)).toBe(GRID);
});

test('Alt+drag across columns highlights a rectangle', async ({ page }) => {
  await bootEditor(page);
  await altDrag(page, [0, 0], [2, 5]);
  await expect(page.locator('#selOverlay .block-rect')).toHaveCount(3);
  await expect(page.locator('#selOverlay .block-caret')).toHaveCount(0);
});

test('Backspace removes the selected rectangle from every line', async ({ page }) => {
  await bootEditor(page);
  await altDrag(page, [0, 0], [2, 6]);
  await page.keyboard.press('Backspace');
  expect(await editorValue(page)).toBe('one\ntwo\ne 3\ndelta four');
});

test('typing over a rectangle replaces it on every line', async ({ page }) => {
  await bootEditor(page);
  await altDrag(page, [0, 0], [1, 5]);
  await page.keyboard.type('X');            // columns 0-4 ("alpha"/"bravo") replaced
  expect(await editorValue(page)).toBe('X one\nX two\ncharlie 3\ndelta four');
});

test('a zero-width column Backspace deletes one character per line', async ({ page }) => {
  await bootEditor(page);
  await altDrag(page, [0, 2], [2, 2]);
  await page.keyboard.press('Backspace');
  expect(await editorValue(page)).toBe('apha one\nbavo two\ncarlie 3\ndelta four');
});

test('copy yields the rectangle, one line per row', async ({ page }) => {
  await bootEditor(page);
  await altDrag(page, [0, 0], [2, 5]);
  const copied = await page.evaluate(() => {
    let out = null;
    const e = new Event('copy', { bubbles: true, cancelable: true });
    e.clipboardData = { setData: (_t, v) => { out = v; } };
    document.getElementById('editor').dispatchEvent(e);
    return out;
  });
  expect(copied).toBe('alpha\nbravo\ncharl');
});

test('pasting a block-shaped clipboard distributes it line by line', async ({ page }) => {
  await bootEditor(page);
  await altDrag(page, [0, 0], [2, 0]);
  await page.evaluate(() => {
    const e = new Event('paste', { bubbles: true, cancelable: true });
    e.clipboardData = { getData: () => '1. \n2. \n3. ' };
    document.getElementById('editor').dispatchEvent(e);
  });
  expect(await editorValue(page)).toBe('1. alpha one\n2. bravo two\n3. charlie 3\ndelta four');
});

test('pasting a single line repeats it on every selected line', async ({ page }) => {
  await bootEditor(page);
  await altDrag(page, [0, 0], [2, 0]);
  await page.evaluate(() => {
    const e = new Event('paste', { bubbles: true, cancelable: true });
    e.clipboardData = { getData: () => '# ' };
    document.getElementById('editor').dispatchEvent(e);
  });
  expect(await editorValue(page)).toBe('# alpha one\n# bravo two\n# charlie 3\ndelta four');
});

test('lines too short for the column range are left alone', async ({ page }) => {
  await bootEditor(page, 'a long first line here\nshort\nanother long line here');
  await altDrag(page, [0, 10], [2, 15]);
  await page.keyboard.press('Backspace');
  // "short" has nothing at columns 10-15, so it survives untouched.
  expect(await editorValue(page)).toBe('a long firne here\nshort\nanother lone here');
});

test('Escape and a plain click both clear the column selection', async ({ page }) => {
  await bootEditor(page);
  await altDrag(page, [0, 0], [2, 3]);
  await expect(page.locator('#selOverlay .block-rect')).not.toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#selOverlay > *')).toHaveCount(0);

  await altDrag(page, [0, 0], [2, 3]);
  await expect(page.locator('#selOverlay .block-rect')).not.toHaveCount(0);
  await page.locator('#editor').click();
  await expect(page.locator('#selOverlay > *')).toHaveCount(0);
});

test('a column selection does not survive switching tabs', async ({ page }) => {
  await boot(page, {
    openResponse: ['C:\\d\\a.md', 'C:\\d\\b.md'],
    files: { 'C:\\d\\a.md': GRID, 'C:\\d\\b.md': GRID },
  });
  await page.keyboard.press('Control+o');
  await page.keyboard.press('Control+1');
  await page.locator('#editor').click();
  await altDrag(page, [0, 0], [2, 3]);
  await expect(page.locator('#selOverlay .block-rect')).not.toHaveCount(0);
  await page.locator('.tab').first().click();
  await expect(page.locator('#selOverlay > *')).toHaveCount(0);
});

test('a normal drag without Alt still selects text the usual way', async ({ page }) => {
  await bootEditor(page);
  const g = await editorGeometry(page);
  const a = cell(g, 0, 0), b = cell(g, 0, 5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  const sel = await page.evaluate(() => {
    const ta = document.getElementById('editor');
    return ta.value.slice(ta.selectionStart, ta.selectionEnd);
  });
  expect(sel).toBe('alpha');
  await expect(page.locator('#selOverlay > *')).toHaveCount(0);
});

// ---------------------------------------------------------------
// Editor context menu
// ---------------------------------------------------------------

// Match on the label attribute: an item's text also contains its shortcut hint.
const menuItem = (page, label) =>
  page.locator(`#ctxMenu .menu-item[data-label="${label}"]`);

async function openEditorMenu(page, text, selStart, selEnd) {
  await boot(page);
  await page.keyboard.press('Control+1');
  await setEditor(page, text ?? 'hello world', selStart ?? 0, selEnd ?? 0);
  // Dispatch the event rather than pressing the right button: a real press
  // moves the caret first (exactly as Windows does when you click outside a
  // selection), and these tests are about what the menu does to a selection
  // that is already there.
  await page.evaluate(() => {
    const ta = document.getElementById('editor');
    const r = ta.getBoundingClientRect();
    ta.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 20,
    }));
  });
  await expect(page.locator('#ctxMenu')).toBeVisible();
}

test('right-clicking the editor opens the formatting menu', async ({ page }) => {
  await openEditorMenu(page);
  for (const label of ['Add link', 'Format', 'Paragraph', 'Insert', 'Cut', 'Copy', 'Paste', 'Select all']) {
    await expect(menuItem(page, label)).toHaveCount(1);
  }
});

test('the Format submenu applies bold to the selection', async ({ page }) => {
  await openEditorMenu(page, 'make me bold', 5, 7);
  await menuItem(page, 'Format').hover();
  await menuItem(page, 'Bold').click();
  expect(await editorValue(page)).toBe('make **me** bold');
  await expect(page.locator('#ctxMenu')).toBeHidden();
});

test('the Paragraph submenu sets a heading and ticks the current one', async ({ page }) => {
  await openEditorMenu(page, '## Existing heading', 5, 5);
  await menuItem(page, 'Paragraph').hover();
  // The line is already an H2, so that entry carries the check.
  await expect(menuItem(page, 'Heading 2').locator('.menu-check')).toHaveCount(1);
  await expect(menuItem(page, 'Heading 1').locator('.menu-check')).toHaveCount(0);
  await menuItem(page, 'Heading 3').click();
  expect(await editorValue(page)).toBe('### Existing heading');
});

test('the Paragraph submenu makes a task list', async ({ page }) => {
  await openEditorMenu(page, 'first\nsecond', 0, 12);
  await menuItem(page, 'Paragraph').hover();
  await menuItem(page, 'Task list').click();
  expect(await editorValue(page)).toBe('- [ ] first\n- [ ] second');
});

test('the Insert submenu inserts a table', async ({ page }) => {
  await openEditorMenu(page, '', 0, 0);
  await menuItem(page, 'Insert').hover();
  await menuItem(page, 'Table').click();
  expect(await editorValue(page)).toContain('| Column 1 | Column 2 |');
});

test('Clear formatting strips inline markers from the selection', async ({ page }) => {
  const text = 'plain **bold** and *italic* and ~~struck~~ and `code` end';
  await openEditorMenu(page, text, 0, text.length);
  await menuItem(page, 'Format').hover();
  await menuItem(page, 'Clear formatting').click();
  expect(await editorValue(page)).toBe('plain bold and italic and struck and code end');
});

test('Cut and Copy are disabled without a selection', async ({ page }) => {
  await openEditorMenu(page, 'no selection here', 3, 3);
  await expect(menuItem(page, 'Cut')).toBeDisabled();
  await expect(menuItem(page, 'Copy')).toBeDisabled();
  await expect(menuItem(page, 'Paste')).toBeEnabled();
});

test('Paste inserts the clipboard text at the caret', async ({ page }) => {
  await boot(page, { clipboardText: 'PASTED' });
  await page.keyboard.press('Control+1');
  await setEditor(page, 'ab', 1, 1);
  await page.evaluate(() => {
    const ta = document.getElementById('editor');
    const r = ta.getBoundingClientRect();
    ta.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 20,
    }));
  });
  await menuItem(page, 'Paste').click();
  await expect.poll(() => editorValue(page)).toBe('aPASTEDb');
});

test('Select all selects the whole document', async ({ page }) => {
  await openEditorMenu(page, 'one\ntwo\nthree', 0, 0);
  await menuItem(page, 'Select all').click();
  const sel = await page.evaluate(() => {
    const ta = document.getElementById('editor');
    return [ta.selectionStart, ta.selectionEnd, ta.value.length];
  });
  expect(sel[0]).toBe(0);
  expect(sel[1]).toBe(sel[2]);
});

test('Escape and clicking away both close the menu', async ({ page }) => {
  await openEditorMenu(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#ctxMenu')).toBeHidden();
  await page.locator('#editor').click({ button: 'right' });
  await expect(page.locator('#ctxMenu')).toBeVisible();
  await page.locator('#btn-view-split').click();
  await expect(page.locator('#ctxMenu')).toBeHidden();
});

// ---------------------------------------------------------------
// Live view
// ---------------------------------------------------------------

const LIVE_DOC = '# Title\n\nFirst paragraph here.\n\n- [ ] Sam B.\n- [x] Done\n\nLast paragraph.\n';

// Open a document in live view with the caret at `caret`.
async function live(page, text, caret) {
  await boot(page);
  await setEditor(page, text === undefined ? LIVE_DOC : text, caret ?? 0);
  await page.keyboard.press('Control+4');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'live');
  await page.waitForFunction(() => document.querySelector('#liveLayer .live-gap') !== null);
}

// Which block is opened as raw source, and whether the editor sits exactly
// over the hole it left. A non-zero offset means the two layouts disagree.
// The reveal is laid out on an animation frame, so wait for one first.
const liveState = (page) =>
  page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const layer = document.getElementById('liveLayer');
    const ed = document.getElementById('editor');
    const gaps = Array.from(layer.querySelectorAll('.live-gap'));
    return {
      blocks: layer.children.length,
      gapIndex: gaps.length ? Array.from(layer.children).indexOf(gaps[0]) : null,
      gapCount: gaps.length,
      offset: gaps.length
        ? Math.round(ed.getBoundingClientRect().top - gaps[0].getBoundingClientRect().top)
        : null,
      caret: ed.selectionStart,
    };
  });

test('live view renders the document and opens the caret’s block as source', async ({ page }) => {
  await live(page);
  // Everything but the open block is rendered markdown.
  await expect(page.locator('#liveLayer h1')).toHaveText('Title');
  await expect(page.locator('#liveLayer ul.contains-task-list li')).toHaveCount(2);
  const s = await liveState(page);
  expect(s.gapIndex).toBe(0);      // the caret is on line 0, the heading
  expect(s.offset).toBe(0);        // editor lands exactly in the hole
});

test('moving the caret moves which block is open', async ({ page }) => {
  await live(page);
  const seen = [];
  for (let i = 0; i < 6; i++) {
    seen.push(await liveState(page));
    await page.keyboard.press('ArrowDown');
  }
  // The reveal walks down with the caret, and never drifts off its hole.
  expect(seen.map((s) => s.gapIndex)).toEqual([0, 1, 2, 3, 4, 4]);
  expect(seen.every((s) => s.offset === 0)).toBe(true);
});

test('a selection spanning blocks opens all of them', async ({ page }) => {
  await live(page, LIVE_DOC, 0);
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.setSelectionRange(2, 30);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect
    .poll(async () => (await liveState(page)).gapCount)
    .toBeGreaterThan(1);
});

test('typing in live view edits the document', async ({ page }) => {
  await live(page);
  await page.keyboard.press('End');
  await page.keyboard.type(' here');
  expect((await editorValue(page)).split('\n')[0]).toBe('# Title here');
  expect((await liveState(page)).offset).toBe(0);
});

test('clicking rendered text puts the caret at that word', async ({ page }) => {
  await live(page);
  const at = await page.evaluate(() => {
    const p = Array.from(document.querySelectorAll('#liveLayer p'))
      .find((el) => el.textContent.startsWith('Last'));
    const r = document.createRange();
    r.setStart(p.firstChild, 14);   // between "paragraph" and "."
    r.collapse(true);
    const box = r.getBoundingClientRect();
    return { x: box.left, y: box.top + box.height / 2 };
  });
  await page.mouse.click(at.x, at.y);
  const s = await liveState(page);
  const value = await editorValue(page);
  expect(value.slice(s.caret - 9, s.caret)).toBe('paragraph');
  expect(s.gapIndex).toBe(6);   // and that block is now the open one
});

test('ticking a checkbox edits the source without moving the caret', async ({ page }) => {
  await live(page);
  await page.locator('#liveLayer input.task-list-item-checkbox').first().click();
  await expect
    .poll(async () => (await editorValue(page)).split('\n')[4])
    .toBe('- [x] Sam B.');
  const s = await liveState(page);
  expect(s.caret).toBe(0);      // the reading position is left alone
  expect(s.gapIndex).toBe(0);
});

test('links open on Ctrl+click and place the caret on a plain click', async ({ page }) => {
  // The caret sits in the first block, so the second one stays rendered.
  await live(page, 'Somewhere else.\n\nText with a [link](https://example.com/x) here.\n', 0);
  await page.locator('#liveLayer a[href]').click({ modifiers: ['Control'] });
  expect(await page.evaluate(() => window.__TAURI_TEST__.openedUrls))
    .toEqual(['https://example.com/x']);
  // A plain click edits the link text instead of following it.
  await page.keyboard.press('Control+1');
  await page.keyboard.press('Control+4');
  await page.locator('#liveLayer a[href]').click();
  expect(await page.evaluate(() => window.__TAURI_TEST__.openedUrls))
    .toEqual(['https://example.com/x']);
  const s = await liveState(page);
  expect(s.gapIndex).toBe(2);   // that block opened for editing instead
});

test('leaving live view gives the editor back its full size', async ({ page }) => {
  await live(page);
  await page.keyboard.press('Control+1');
  const s = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    return {
      inline: ed.getAttribute('style') || '',
      gaps: document.querySelectorAll('#liveLayer .live-gap').length,
      tall: ed.getBoundingClientRect().height > 200,
    };
  });
  expect(s.inline).toBe('');
  expect(s.gaps).toBe(0);
  expect(s.tall).toBe(true);
});

test('live view follows a tab switch', async ({ page }) => {
  await live(page);
  await page.keyboard.press('Control+t');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'live');
  await setEditor(page, '## Second document\n');
  await expect(page.locator('#liveLayer')).toHaveText(/Second document|## Second/);
  await page.keyboard.press('Alt+1');
  await expect(page.locator('#liveLayer h1')).toHaveText('Title');
});

test('column selection says where it lives instead of doing nothing', async ({ page }) => {
  await live(page);
  const box = await page.locator('#editor').boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + 10, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 5);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(page.locator('#toast')).toContainText('Edit view');
});

test('right-clicking rendered text opens the formatting menu there', async ({ page }) => {
  await live(page, 'First block.\n\nSecond block here.\n', 0);
  const at = await page.evaluate(() => {
    const p = Array.from(document.querySelectorAll('#liveLayer p'))
      .find((el) => el.textContent.startsWith('Second'));
    const r = p.getBoundingClientRect();
    return { x: r.left + 20, y: r.top + r.height / 2 };
  });
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(page.locator('#ctxMenu')).toBeVisible();
  // The caret moved to what was right-clicked, so the menu acts on that block.
  expect((await liveState(page)).gapIndex).toBe(2);
});

test('dragging across rendered text selects it in the editor', async ({ page }) => {
  await live(page, '# Title\n\nFirst paragraph with several words.\n\nSecond paragraph too.\n', 0);
  const pts = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('#liveLayer p'));
    const a = ps[0].getBoundingClientRect();
    const b = ps[1].getBoundingClientRect();
    return { ax: a.left + 30, ay: a.top + a.height / 2, bx: b.left + 60, by: b.top + b.height / 2 };
  });
  await page.mouse.move(pts.ax, pts.ay);
  await page.mouse.down();
  await page.mouse.move(pts.bx, pts.by, { steps: 8 });
  await page.mouse.up();
  // The highlight was real HTML the editor knew nothing about; it has to end
  // up as a real editor selection, or the toolbar would act on nothing.
  const sel = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    return {
      text: ed.value.slice(ed.selectionStart, ed.selectionEnd),
      focused: document.activeElement === ed,
    };
  });
  expect(sel.focused).toBe(true);
  expect(sel.text).toContain('paragraph with several words');
  expect(sel.text).toContain('Second');
  // Bold now applies to what was dragged over, rather than silently doing nothing.
  await page.keyboard.press('Control+b');
  expect(await editorValue(page)).toContain('**');
});
