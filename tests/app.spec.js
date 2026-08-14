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
