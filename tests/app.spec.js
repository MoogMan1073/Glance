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
          throw new Error('unknown command ' + cmd);
        },
      },
      dialog: {
        ask: async (msg) => { T().asks.push(msg); return T().askResponse; },
        open: async () => T().openResponse,
        save: async () => T().saveResponse,
      },
      window: {
        getCurrentWindow: () => ({
          setTitle: async (t) => { T().title = t; },
          show: async () => {},
          setFocus: async () => {},
          close: async () => { T().closed = true; },
          onCloseRequested: (h) => { T().closeHandler = h; },
        }),
      },
      webview: {
        getCurrentWebview: () => ({
          onDragDropEvent: (h) => { T().dropHandler = h; },
        }),
      },
      opener: { openUrl: async (u) => { T().openedUrls.push(u); } },
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

test('dirty document shows ● and open prompts before discarding', async ({ page }) => {
  await boot(page, { askResponse: false, openResponse: 'C:\\docs\\b.md', files: { 'C:\\docs\\b.md': 'B' } });
  await setEditor(page, 'unsaved work');
  await expect(page).toHaveTitle(/^● Untitled/);
  await page.keyboard.press('Control+o');
  // User answered "no" to discarding: nothing was opened.
  expect(await editorValue(page)).toBe('unsaved work');
  const asks = await page.evaluate(() => window.__TAURI_TEST__.asks);
  expect(asks.length).toBe(1);
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
