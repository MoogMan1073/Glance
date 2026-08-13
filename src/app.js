// ============================================================
// Glance — application logic
// Plain JS, no build step. Talks to Tauri through the small
// facade below so the UI also runs (and is tested) in a browser.
// ============================================================
(function () {
  'use strict';

  // ---------------- Tauri facade ----------------

  const T = window.__TAURI__ || null;

  const tauri = {
    available: !!T,
    invoke: (cmd, args) => T ? T.core.invoke(cmd, args) : Promise.reject(new Error('Tauri unavailable')),
    ask: (msg, opts) => T ? T.dialog.ask(msg, opts) : Promise.resolve(window.confirm(msg)),
    openDialog: (opts) => T ? T.dialog.open(opts) : Promise.resolve(null),
    saveDialog: (opts) => T ? T.dialog.save(opts) : Promise.resolve(null),
    openUrl: (url) => T ? T.opener.openUrl(url) : Promise.resolve(window.open(url, '_blank')),
    convertFileSrc: (T && T.core && T.core.convertFileSrc) ? (p) => T.core.convertFileSrc(p) : null,
    listen: (evt, handler) => (T && T.event) ? T.event.listen(evt, handler) : null,
    setTitle: (title) => { if (T) T.window.getCurrentWindow().setTitle(title).catch(() => {}); },
    currentWindow: () => T ? T.window.getCurrentWindow() : null,
    currentWebview: () => (T && T.webview) ? T.webview.getCurrentWebview() : null,
  };

  const MD_FILTERS = [
    { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
    { name: 'Text', extensions: ['txt'] },
    { name: 'All files', extensions: ['*'] },
  ];
  const MD_EXT_RE = /\.(md|markdown|mdown|mkd|txt)$/i;

  // ---------------- Elements ----------------

  const editor = document.getElementById('editor');
  const preview = document.getElementById('preview');
  const previewPane = document.getElementById('previewPane');
  const tabbar = document.getElementById('tabbar');
  const headingSelect = document.getElementById('sel-heading');
  const themeBtn = document.getElementById('btn-theme');
  const helpOverlay = document.getElementById('helpOverlay');
  const helpContent = document.getElementById('helpContent');
  const toast = document.getElementById('toast');

  // ---------------- Documents ----------------
  // Every open file is a doc. The editor and preview show whichever one is
  // active; the rest keep their text, caret, and scroll position in memory so
  // switching back lands exactly where you left off.

  let docs = [];
  let activeId = null;
  let seq = 0;
  let helpLoaded = false;

  function makeDoc(path, content) {
    return {
      id: ++seq,
      path: path || null,
      content: content || '',
      savedContent: content || '',
      selStart: 0,
      selEnd: 0,
      editorScroll: 0,
      previewScroll: 0,
      html: null, // cached render; null means stale
    };
  }

  const activeDoc = () => docs.find((d) => d.id === activeId) || null;
  const docDirty = (d) => !!d && d.content !== d.savedContent;
  const isDirty = () => docDirty(activeDoc());
  const findByPath = (path) => docs.find((d) => d.path === path) || null;

  // Pull the live editor state back into the active doc before anything reads
  // or replaces it — the textarea is the source of truth while a doc is shown.
  function captureActive() {
    const d = activeDoc();
    if (!d) return;
    d.content = editor.value;
    d.selStart = editor.selectionStart;
    d.selEnd = editor.selectionEnd;
    d.editorScroll = editor.scrollTop;
    d.previewScroll = previewPane.scrollTop;
  }

  // ---------------- Markdown renderer ----------------

  function buildRenderer() {
    const md = window.markdownit({
      html: false,          // never interpret raw HTML from documents
      linkify: true,
      breaks: false,
      highlight: (str, lang) => {
        if (window.hljs && lang && window.hljs.getLanguage(lang)) {
          try { return window.hljs.highlight(str, { language: lang, ignoreIllegals: true }).value; }
          catch (e) { /* fall through to escaping */ }
        }
        return '';
      },
    });
    const use = (plugin, ...opts) => { if (plugin) md.use(plugin, ...opts); };
    use(window.markdownitTaskLists, { label: true });
    use(window.markdownitFootnote);
    use(window.markdownitDeflist);
    use(window.markdownitMark);
    use(window.markdownitSub);
    use(window.markdownitSup);
    const emoji = window.markdownitEmoji;
    use(emoji && (emoji.full || emoji.default || emoji));
    use(window.markdownItAttrs, { allowedAttributes: ['id', 'class'] });

    // Local images: serve relative / absolute file paths through Tauri's
    // asset protocol so photos referenced by documents actually render.
    // The base path travels in `env` rather than a shared variable, so each
    // tab resolves against its own folder.
    const defaultImage = md.renderer.rules.image ||
      ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const resolved = resolveLocalImage(token.attrGet('src') || '', env && env.basePath);
      if (resolved) token.attrSet('src', resolved);
      return defaultImage(tokens, idx, options, env, self);
    };
    return md;
  }

  // Map a markdown image src to an asset-protocol URL when it points at a
  // file on disk. Relative paths resolve against the open file's folder.
  function resolveLocalImage(src, basePath) {
    if (!tauri.convertFileSrc) return null;
    if (/^(https?:|data:|asset:|blob:|#)/i.test(src)) return null;
    let path;
    try { path = decodeURIComponent(src); } catch (e) { path = src; }
    const isAbsolute = /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(path);
    if (!isAbsolute) {
      if (!basePath || !/[\\/]/.test(basePath)) return null; // unsaved doc: no base folder
      path = basePath.replace(/[\\/][^\\/]*$/, '') + '/' + path;
    }
    try { return tauri.convertFileSrc(path); } catch (e) { return null; }
  }

  const md = buildRenderer();

  function renderPreview(restoreScroll) {
    const d = activeDoc();
    if (!d) return;
    if (d.html === null) d.html = md.render(d.content, { basePath: d.path });
    preview.innerHTML = d.html;
    if (restoreScroll) previewPane.scrollTop = d.previewScroll;
  }

  let renderTimer = null;
  function scheduleRender() {
    const d = activeDoc();
    if (d) d.html = null;
    if (document.body.dataset.view === 'edit') return; // render lazily when preview becomes visible
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      const cur = activeDoc();
      if (cur && cur.html === null) renderPreview(false);
    }, 120);
  }

  // ---------------- Toast ----------------

  let toastTimer = null;
  function showToast(message, isError) {
    toast.textContent = message;
    toast.classList.toggle('error', !!isError);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, isError ? 5000 : 1800);
  }

  // ---------------- Title & tab bar ----------------

  function baseName(path) {
    return path ? path.split(/[\\/]/).pop() : 'Untitled';
  }

  function updateTitle() {
    const d = activeDoc();
    const title = `${docDirty(d) ? '● ' : ''}${baseName(d && d.path)} - Glance`;
    document.title = title;
    tauri.setTitle(title);
  }

  const CLOSE_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.1 3 8 6.9 11.9 3 13 4.1 9.1 8l3.9 3.9-1.1 1.1L8 9.1 4.1 13 3 11.9 6.9 8 3 4.1 4.1 3z"/></svg>';

  function renderTabs() {
    document.body.dataset.tabs = docs.length > 1 ? 'many' : 'single';
    tabbar.textContent = '';
    for (const d of docs) {
      const tab = document.createElement('div');
      tab.className = 'tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(d.id === activeId));
      tab.dataset.id = String(d.id);
      tab.dataset.dirty = String(docDirty(d));
      tab.title = d.path || 'Untitled';

      const name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = baseName(d.path);
      tab.appendChild(name);

      const close = document.createElement('button');
      close.className = 'tab-close';
      close.innerHTML = CLOSE_SVG;
      close.title = 'Close (Ctrl+W)';
      close.setAttribute('aria-label', `Close ${baseName(d.path)}`);
      tab.appendChild(close);

      tabbar.appendChild(tab);
      if (d.id === activeId && docs.length > 1) {
        // Keep the active tab reachable when the strip overflows.
        requestAnimationFrame(() => tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      }
    }
  }

  // ---------------- Tab operations ----------------

  function activate(id, focusEditor) {
    if (id === activeId) return;
    captureActive();
    const d = docs.find((x) => x.id === id);
    if (!d) return;
    activeId = id;
    editor.value = d.content;
    editor.setSelectionRange(d.selStart, d.selEnd);
    editor.scrollTop = d.editorScroll;
    if (document.body.dataset.view !== 'edit') renderPreview(true);
    renderTabs();
    updateTitle();
    updateHeadingSelect();
    if (focusEditor !== false && document.body.dataset.view !== 'read') editor.focus();
  }

  // A brand-new empty doc is a placeholder, not work — opening a file reuses
  // it instead of leaving a stray "Untitled" tab behind, the way browsers do.
  function isDisposable(d) {
    return !!d && !d.path && d.content === '' && d.savedContent === '';
  }

  function addDoc(path, content, options) {
    const opts = options || {};
    const existing = path ? findByPath(path) : null;
    if (existing) {
      activate(existing.id, opts.focusEditor);
      return existing;
    }
    captureActive();
    const doc = makeDoc(path, content);
    const cur = activeDoc();
    if (opts.replaceDisposable !== false && isDisposable(cur)) {
      docs.splice(docs.indexOf(cur), 1);
    }
    docs.push(doc);
    activeId = doc.id;
    editor.value = doc.content;
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    previewPane.scrollTop = 0;
    if (document.body.dataset.view !== 'edit') renderPreview(false);
    renderTabs();
    updateTitle();
    updateHeadingSelect();
    if (opts.focusEditor !== false && document.body.dataset.view !== 'read') editor.focus();
    return doc;
  }

  async function closeDoc(id) {
    const d = docs.find((x) => x.id === id);
    if (!d) return false;
    if (d.id === activeId) captureActive();
    if (docDirty(d)) {
      const ok = await tauri.ask(
        `${baseName(d.path)} has unsaved changes. Close it anyway?`,
        { title: 'Glance', kind: 'warning' }
      );
      if (!ok) return false;
    }
    const idx = docs.indexOf(d);
    docs.splice(idx, 1);

    if (!docs.length) {
      // Last tab closed: nothing left to show, so the window goes with it.
      const win = tauri.currentWindow();
      if (win) win.destroy ? win.destroy() : win.close();
      else { addDoc(null, ''); }
      return true;
    }
    if (d.id === activeId) {
      const next = docs[Math.min(idx, docs.length - 1)];
      activeId = null;         // force activate() past its no-op guard
      activate(next.id);
    } else {
      renderTabs();
    }
    return true;
  }

  function cycleTab(delta) {
    if (docs.length < 2) return;
    const i = docs.findIndex((d) => d.id === activeId);
    const next = docs[(i + delta + docs.length) % docs.length];
    activate(next.id);
  }

  tabbar.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const id = Number(tab.dataset.id);
    if (e.target.closest('.tab-close')) closeDoc(id);
    else activate(id);
  });

  // Middle-click closes, as in every browser.
  tabbar.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const tab = e.target.closest('.tab');
    if (!tab) return;
    e.preventDefault();
    closeDoc(Number(tab.dataset.id));
  });

  // ---------------- Views ----------------

  const VIEWS = ['edit', 'split', 'read'];

  function setView(view) {
    if (!VIEWS.includes(view)) return;
    const prev = document.body.dataset.view;
    document.body.dataset.view = view;
    for (const v of VIEWS) {
      document.getElementById('btn-view-' + v).classList.toggle('active', v === view);
    }
    const d = activeDoc();
    if (view !== 'edit' && d && d.html === null) renderPreview(prev === 'edit');
    if (view !== 'read') editor.focus();
  }

  // ---------------- Theme ----------------

  const THEMES = ['system', 'light', 'dark'];
  const THEME_ICONS = {
    system: '<svg viewBox="0 0 16 16"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h10a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 13 12H9.5v1.5H11a.75.75 0 0 1 0 1.5H5a.75.75 0 0 1 0-1.5h1.5V12H3a1.5 1.5 0 0 1-1.5-1.5v-7zM3 3.5v7h10v-7H3z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 16 16"><path d="M8 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM8 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 8 0zm0 13a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 13zM0 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 8zm13 0a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 13 8zM2.34 2.34a.75.75 0 0 1 1.06 0l1.06 1.06a.75.75 0 1 1-1.06 1.06L2.34 3.4a.75.75 0 0 1 0-1.06zm9.2 9.2a.75.75 0 0 1 1.06 0l1.06 1.06a.75.75 0 1 1-1.06 1.06l-1.06-1.06a.75.75 0 0 1 0-1.06zm2.12-9.2a.75.75 0 0 1 0 1.06L12.6 4.46a.75.75 0 1 1-1.06-1.06l1.06-1.06a.75.75 0 0 1 1.06 0zm-9.2 9.2a.75.75 0 0 1 0 1.06L3.4 13.66a.75.75 0 0 1-1.06-1.06l1.06-1.06a.75.75 0 0 1 1.06 0z" fill="currentColor"/></svg>',
    dark: '<svg viewBox="0 0 16 16"><path d="M6.2 1.2a6.8 6.8 0 1 0 8.6 8.6A5.9 5.9 0 0 1 6.2 1.2z" fill="currentColor"/></svg>',
  };

  let themePref = 'system';
  try { themePref = localStorage.getItem('smr-theme') || 'system'; } catch (e) {}
  if (!THEMES.includes(themePref)) themePref = 'system';

  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyTheme() {
    const effective = themePref === 'system'
      ? (darkQuery && darkQuery.matches ? 'dark' : 'light')
      : themePref;
    document.body.dataset.theme = effective;
    document.documentElement.dataset.bootTheme = effective;
    const light = document.getElementById('hljs-light');
    const dark = document.getElementById('hljs-dark');
    if (light) light.disabled = effective === 'dark';
    if (dark) dark.disabled = effective !== 'dark';
    const label = themePref.charAt(0).toUpperCase() + themePref.slice(1);
    themeBtn.title = `Theme: ${label} (Ctrl+Shift+D)`;
    themeBtn.innerHTML = THEME_ICONS[themePref];
  }

  function cycleTheme() {
    themePref = THEMES[(THEMES.indexOf(themePref) + 1) % THEMES.length];
    try { localStorage.setItem('smr-theme', themePref); } catch (e) {}
    applyTheme();
    showToast(`Theme: ${themePref}`);
  }

  if (darkQuery && darkQuery.addEventListener) {
    darkQuery.addEventListener('change', () => { if (themePref === 'system') applyTheme(); });
  }

  // ---------------- Editor text manipulation ----------------
  // All edits go through execCommand('insertText') so the native
  // undo/redo stack (Ctrl+Z / Ctrl+Y) keeps working.

  function replaceRange(start, end, text, selStart, selEnd) {
    editor.focus();
    editor.setSelectionRange(start, end);
    let ok = false;
    try {
      ok = text === ''
        ? document.execCommand('delete')
        : document.execCommand('insertText', false, text);
    } catch (e) { ok = false; }
    if (!ok) {
      editor.setRangeText(text, start, end, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (selStart !== undefined) {
      editor.setSelectionRange(selStart, selEnd === undefined ? selStart : selEnd);
    }
  }

  // The full lines covered by the current selection.
  function selectedLineRange() {
    const value = editor.value;
    let selStart = editor.selectionStart;
    let selEnd = editor.selectionEnd;
    // A selection ending just after a newline shouldn't pull in the next line.
    if (selEnd > selStart && value[selEnd - 1] === '\n') selEnd -= 1;
    const start = value.lastIndexOf('\n', selStart - 1) + 1;
    let end = value.indexOf('\n', selEnd);
    if (end === -1) end = value.length;
    return { start, end };
  }

  function transformSelectedLines(fn) {
    const { start, end } = selectedLineRange();
    const selStart = editor.selectionStart;
    const collapsed = selStart === editor.selectionEnd;
    const block = editor.value.slice(start, end);
    const lines = block.split('\n');
    const newLines = fn(lines.slice());
    const newBlock = newLines.join('\n');
    if (newBlock === block) return;
    if (!collapsed) {
      replaceRange(start, end, newBlock, start, start + newBlock.length);
      return;
    }
    // A collapsed caret must stay collapsed — leaving the block selected
    // would make the next keystroke replace the whole line. Keep the caret
    // on its line, shifted by that line's length change.
    const beforeCaret = block.slice(0, selStart - start);
    const lineIdx = beforeCaret.split('\n').length - 1;
    const offsetInLine = selStart - start - (beforeCaret.lastIndexOf('\n') + 1);
    const newLineStart = newLines.slice(0, lineIdx).join('\n').length + (lineIdx > 0 ? 1 : 0);
    const delta = newLines[lineIdx].length - lines[lineIdx].length;
    const newOffset = Math.max(0, Math.min(newLines[lineIdx].length, offsetInLine + delta));
    replaceRange(start, end, newBlock, start + newLineStart + newOffset);
  }

  const LIST_MARKER_RE = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;

  function stripListMarker(line) {
    return line.replace(LIST_MARKER_RE, '$1');
  }

  // Toggle a marker at the start of each selected line (after indentation).
  function toggleLinePrefix(kind) {
    const testers = {
      ul: (l) => /^\s*[-*+]\s+(?!\[[ xX]\]\s)/.test(l),
      ol: (l) => /^\s*\d+[.)]\s+/.test(l),
      task: (l) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(l),
      quote: (l) => /^\s*>\s?/.test(l),
    };
    transformSelectedLines((lines) => {
      const content = lines.filter((l) => l.trim() !== '');
      const allSet = content.length > 0 && content.every(testers[kind]);
      let n = 0;
      return lines.map((line) => {
        if (line.trim() === '') return line;
        if (kind === 'quote') {
          return allSet ? line.replace(/^(\s*)>\s?/, '$1') : '> ' + line;
        }
        const indent = (line.match(/^\s*/) || [''])[0];
        const rest = stripListMarker(line).slice(indent.length);
        if (allSet) return indent + rest;
        n += 1;
        const marker = kind === 'ul' ? '- ' : kind === 'task' ? '- [ ] ' : `${n}. `;
        return indent + marker + rest;
      });
    });
  }

  function applyHeading(level) {
    transformSelectedLines((lines) =>
      lines.map((line) => {
        if (line.trim() === '' && level > 0) return line;
        const rest = line.replace(/^\s*#{1,6}\s+/, '');
        return level > 0 ? '#'.repeat(level) + ' ' + rest : rest;
      })
    );
    updateHeadingSelect();
  }

  function currentLineHeadingLevel() {
    const value = editor.value;
    const start = value.lastIndexOf('\n', editor.selectionStart - 1) + 1;
    const m = value.slice(start, start + 8).match(/^(#{1,6})\s/);
    return m ? m[1].length : 0;
  }

  function updateHeadingSelect() {
    headingSelect.value = String(currentLineHeadingLevel());
  }

  function runLength(text, idx, ch, dir) {
    let n = 0;
    while (idx >= 0 && idx < text.length && text[idx] === ch) { n += 1; idx += dir; }
    return n;
  }

  // Wrap or unwrap the selection with inline markers.
  function toggleInline(marker, endMarker) {
    endMarker = endMarker || marker;
    const value = editor.value;
    const s = editor.selectionStart;
    const e = editor.selectionEnd;
    const sel = value.slice(s, e);

    // For the single-'*' italic marker, a neighboring '*' may really belong
    // to a '**' bold pair (Ctrl+I on "**bold**" must not strip bold's stars).
    // A genuine italic marker sits in an odd-length asterisk run.
    const italicSafe = (leadRun, trailRun) =>
      marker !== '*' || (leadRun % 2 === 1 && trailRun % 2 === 1);

    // Selection includes the markers: **bold** -> bold
    if (sel.length >= marker.length + endMarker.length &&
        sel.startsWith(marker) && sel.endsWith(endMarker) &&
        italicSafe(runLength(sel, 0, '*', 1), runLength(sel, sel.length - 1, '*', -1))) {
      const inner = sel.slice(marker.length, sel.length - endMarker.length);
      replaceRange(s, e, inner, s, s + inner.length);
      return;
    }
    // Markers just outside the selection: **|bold|** -> bold
    if (value.slice(s - marker.length, s) === marker &&
        value.slice(e, e + endMarker.length) === endMarker &&
        italicSafe(runLength(value, s - 1, '*', -1), runLength(value, e, '*', 1))) {
      replaceRange(s - marker.length, e + endMarker.length, sel,
        s - marker.length, s - marker.length + sel.length);
      return;
    }
    // Wrap.
    replaceRange(s, e, marker + sel + endMarker,
      s + marker.length, s + marker.length + sel.length);
  }

  function insertSnippet(before, placeholder, after) {
    const s = editor.selectionStart;
    const e = editor.selectionEnd;
    const sel = editor.value.slice(s, e) || placeholder;
    const text = before + sel + after;
    replaceRange(s, e, text, s + before.length, s + before.length + sel.length);
  }

  function insertLink() {
    const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (/^https?:\/\/\S+$/.test(sel)) {
      // Selection is a URL: make it the target, select the text slot.
      const s = editor.selectionStart;
      const text = `[text](${sel})`;
      replaceRange(s, editor.selectionEnd, text, s + 1, s + 5);
    } else if (sel) {
      const s = editor.selectionStart;
      const text = `[${sel}](url)`;
      replaceRange(s, editor.selectionEnd, text, s + sel.length + 3, s + sel.length + 6);
    } else {
      insertSnippet('[', 'text', '](url)');
    }
  }

  // Insert text that must sit on its own line(s), with a blank line above —
  // "text\n---" would turn the text into a setext heading, and tables can't
  // interrupt a paragraph.
  function insertBlock(block, caretOffset) {
    const value = editor.value;
    const s = editor.selectionStart;
    const e = editor.selectionEnd;
    let before = '';
    if (s > 0) {
      if (value[s - 1] !== '\n') before = '\n\n';
      else if (s >= 2 && value[s - 2] !== '\n') before = '\n';
    }
    const atLineEnd = e === value.length || value[e] === '\n';
    const after = atLineEnd ? '' : '\n';
    const text = before + block + after;
    const caret = s + before.length + (caretOffset === undefined ? block.length : caretOffset);
    replaceRange(s, e, text, caret);
  }

  function insertCodeBlock() {
    const value = editor.value;
    const s = editor.selectionStart;
    const e = editor.selectionEnd;
    const sel = value.slice(s, e);
    const atLineStart = s === 0 || value[s - 1] === '\n';
    const before = (atLineStart ? '' : '\n') + '```';
    const atEnd = e === value.length || value[e] === '\n';
    const text = before + '\n' + sel + '\n```' + (atEnd ? '' : '\n');
    // Caret right after the opening fence so a language can be typed.
    replaceRange(s, e, text, s + before.length);
  }

  function insertTable() {
    insertBlock(
      '| Column 1 | Column 2 |\n| -------- | -------- |\n| Text     | Text     |\n'
    );
  }

  // ---------------- List continuation & Tab handling ----------------

  function handleEnter(event) {
    if (event.shiftKey || event.ctrlKey || event.altKey) return;
    if (editor.selectionStart !== editor.selectionEnd) return;
    const value = editor.value;
    const caret = editor.selectionStart;
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
    let lineEnd = value.indexOf('\n', caret);
    if (lineEnd === -1) lineEnd = value.length;
    // Judge the WHOLE line, not just the part before the caret: Enter right
    // after "- " on "- item" must split the item, not delete the marker.
    const line = value.slice(lineStart, lineEnd);

    const task = line.match(/^(\s*)([-*+])\s+\[[ xX]\]\s+(.*)$/);
    const bullet = task ? null : line.match(/^(\s*)([-*+])\s+(.*)$/);
    const ordered = task || bullet ? null : line.match(/^(\s*)(\d+)([.)])\s+(.*)$/);
    if (!task && !bullet && !ordered) return;

    const m = task || bullet || ordered;
    const content = m[m.length - 1];
    const markerLen = line.length - content.length;
    if (caret < lineStart + markerLen) return; // caret inside the marker: plain Enter

    event.preventDefault();
    if (content.trim() === '') {
      // Enter on an empty list item ends the list (Word-like).
      replaceRange(lineStart, lineEnd, '', lineStart);
      return;
    }
    let next;
    if (task) next = `\n${task[1]}${task[2]} [ ] `;
    else if (bullet) next = `\n${bullet[1]}${bullet[2]} `;
    else next = `\n${ordered[1]}${Number(ordered[2]) + 1}${ordered[3]} `;
    replaceRange(caret, caret, next, caret + next.length);
  }

  function handleTab(event) {
    event.preventDefault();
    const outdent = event.shiftKey;
    const multiline = editor.value
      .slice(editor.selectionStart, editor.selectionEnd)
      .includes('\n');
    const value = editor.value;
    const lineStart = value.lastIndexOf('\n', editor.selectionStart - 1) + 1;
    const onListLine = LIST_MARKER_RE.test(value.slice(lineStart, lineStart + 24));

    if (!outdent && !multiline && !onListLine) {
      replaceRange(editor.selectionStart, editor.selectionEnd, '  ');
      return;
    }
    transformSelectedLines((lines) =>
      lines.map((line) =>
        outdent ? line.replace(/^ {1,2}/, '') : (line.trim() === '' ? line : '  ' + line)
      )
    );
  }

  // ---------------- File operations ----------------

  async function openPath(path, options) {
    const existing = findByPath(path);
    if (existing) {           // already open: just go there, like a browser
      activate(existing.id, options && options.focusEditor);
      return true;
    }
    try {
      const content = await tauri.invoke('read_text_file', { path });
      addDoc(path, content, options);
      return true;
    } catch (err) {
      showToast(String(err), true);
      return false;
    }
  }

  // With tabs, New and Open never destroy anything, so neither needs to ask
  // about unsaved work — that question moved to closing a tab.
  function fileNew() {
    // An explicit "new tab" always makes one, even from a blank document —
    // reusing the placeholder here would make Ctrl+T look broken.
    addDoc(null, '', { replaceDisposable: false });
    setView('edit');
  }

  async function fileOpen() {
    const picked = await tauri.openDialog({ multiple: true, filters: MD_FILTERS });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    for (const p of paths) {
      if (typeof p === 'string' && p) await openPath(p);
    }
  }

  async function writeTo(path) {
    const d = activeDoc();
    if (!d) return false;
    // Snapshot now: keystrokes typed while the write is in flight must not
    // be marked as saved.
    const contents = editor.value;
    try {
      await tauri.invoke('write_text_file', { path, contents });
      d.path = path;
      d.content = contents;
      d.savedContent = contents;
      if (d.html !== null) d.html = null; // base path may have changed
      renderTabs();
      updateTitle();
      showToast('Saved');
      return true;
    } catch (err) {
      showToast(String(err), true);
      return false;
    }
  }

  async function fileSaveAs() {
    const d = activeDoc();
    let path = await tauri.saveDialog({
      defaultPath: (d && d.path) || 'Untitled.md',
      filters: MD_FILTERS,
    });
    if (!path) return false;
    if (!/\.[^\\/.]+$/.test(path)) path += '.md';
    return writeTo(path);
  }

  async function fileSave() {
    const d = activeDoc();
    if (!d) return false;
    if (!d.path) return fileSaveAs();
    return writeTo(d.path);
  }

  // ---------------- Help ----------------

  async function loadHelp() {
    if (helpLoaded) return;
    try {
      const res = await fetch('help.md');
      helpContent.innerHTML = md.render(await res.text());
      helpLoaded = true;
    } catch (e) {
      helpContent.textContent = 'Help content could not be loaded.';
    }
  }

  function toggleHelp(force) {
    const show = force !== undefined ? force : helpOverlay.hidden;
    helpOverlay.hidden = !show;
    if (show) loadHelp();
    else if (document.body.dataset.view !== 'read') editor.focus();
  }

  // ---------------- Link handling in rendered panes ----------------

  function handleRenderedClick(event, container) {
    const link = event.target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href');
    if (href.startsWith('#')) {
      let target = null;
      try { target = container.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`); }
      catch (e) {}
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (/^https?:\/\//i.test(href)) {
      tauri.openUrl(href).catch(() => showToast('Could not open link', true));
    }
    // Everything else (mailto:, relative paths) is intentionally ignored.
  }

  preview.addEventListener('click', (e) => handleRenderedClick(e, preview));
  helpContent.addEventListener('click', (e) => handleRenderedClick(e, helpContent));

  // ---------------- Scroll sync (split view) ----------------

  let syncing = false;

  function syncScroll(from, to) {
    if (document.body.dataset.view !== 'split' || syncing) return;
    const fromMax = from.scrollHeight - from.clientHeight;
    const toMax = to.scrollHeight - to.clientHeight;
    if (fromMax <= 0 || toMax <= 0) return;
    syncing = true;
    to.scrollTop = (from.scrollTop / fromMax) * toMax;
    requestAnimationFrame(() => { syncing = false; });
  }

  editor.addEventListener('scroll', () => syncScroll(editor, previewPane));
  previewPane.addEventListener('scroll', () => syncScroll(previewPane, editor));

  // ---------------- Toolbar wiring ----------------

  const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);

  on('btn-new', fileNew);
  on('btn-open', fileOpen);
  on('btn-save', fileSave);
  on('btn-saveas', fileSaveAs);
  on('btn-bold', () => toggleInline('**'));
  on('btn-italic', () => toggleInline('*'));
  on('btn-strike', () => toggleInline('~~'));
  on('btn-mark', () => toggleInline('=='));
  on('btn-code', () => toggleInline('`'));
  on('btn-codeblock', insertCodeBlock);
  on('btn-link', insertLink);
  on('btn-image', () => insertSnippet('![', 'alt text', '](url)'));
  on('btn-quote', () => toggleLinePrefix('quote'));
  on('btn-ul', () => toggleLinePrefix('ul'));
  on('btn-ol', () => toggleLinePrefix('ol'));
  on('btn-task', () => toggleLinePrefix('task'));
  on('btn-table', insertTable);
  on('btn-hr', () => insertBlock('---\n'));
  on('btn-view-edit', () => setView('edit'));
  on('btn-view-split', () => setView('split'));
  on('btn-view-read', () => setView('read'));
  on('btn-theme', cycleTheme);
  on('btn-help', () => toggleHelp());
  on('btn-help-close', () => toggleHelp(false));

  helpOverlay.addEventListener('click', (e) => {
    if (e.target === helpOverlay) toggleHelp(false);
  });

  headingSelect.addEventListener('change', () => {
    applyHeading(Number(headingSelect.value));
    editor.focus();
  });

  // ---------------- Editor events ----------------

  editor.addEventListener('input', () => {
    const d = activeDoc();
    if (d) d.content = editor.value;
    scheduleRender();
    updateTitle();
    renderTabs();
  });

  editor.addEventListener('keydown', (e) => {
    // Ctrl+Tab is tab cycling, handled on window. Without this guard the
    // editor would swallow it first and indent the line instead.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') handleEnter(e);
    else if (e.key === 'Tab') handleTab(e);
  });

  ['keyup', 'click', 'focus'].forEach((ev) =>
    editor.addEventListener(ev, updateHeadingSelect)
  );

  // ---------------- Keyboard shortcuts ----------------

  const editingVisible = () => document.body.dataset.view !== 'read';

  window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    // Keys that work everywhere.
    if (e.key === 'F1') { e.preventDefault(); toggleHelp(); return; }
    if (e.key === 'Escape' && !helpOverlay.hidden) { toggleHelp(false); return; }
    if (e.key === 'F5' || (ctrl && !e.altKey && e.key.toLowerCase() === 'r')) {
      e.preventDefault(); return; // block webview reload (incl. Ctrl+Shift+R) — it would drop the document
    }

    // Alt+1..9 jumps to a tab (Alt+9 = last, as in browsers). Ctrl+1/2/3 stays
    // with the views, which are used far more often in a reader.
    if (e.altKey && !ctrl && !e.shiftKey) {
      const m = e.code.match(/^Digit([1-9])$/);
      if (m) {
        e.preventDefault();
        const n = Number(m[1]);
        const target = n === 9 ? docs[docs.length - 1] : docs[n - 1];
        if (target) activate(target.id);
        return;
      }
    }

    if (!ctrl) return;
    // AltGr arrives as Ctrl+Alt on Windows; those combos type characters
    // (#, @, {, … on European layouts) and must never trigger shortcuts.
    if (e.getModifierState && e.getModifierState('AltGraph')) return;

    // Tab cycling, with the browser and VS Code spellings of it.
    if (e.key === 'Tab' || e.code === 'PageDown' || e.code === 'PageUp') {
      const back = e.shiftKey || e.code === 'PageUp';
      e.preventDefault();
      cycleTab(back ? -1 : 1);
      return;
    }

    if (!e.shiftKey && !e.altKey) {
      switch (e.key.toLowerCase()) {
        case 'n': case 't': e.preventDefault(); fileNew(); return;
        case 'o': e.preventDefault(); fileOpen(); return;
        case 's': e.preventDefault(); fileSave(); return;
        case 'w': e.preventDefault(); if (activeId !== null) closeDoc(activeId); return;
      }
      switch (e.code) {
        case 'Digit1': e.preventDefault(); setView('edit'); return;
        case 'Digit2': e.preventDefault(); setView('split'); return;
        case 'Digit3': e.preventDefault(); setView('read'); return;
      }
    }

    if (e.shiftKey && !e.altKey) {
      switch (e.key.toLowerCase()) {
        case 's': e.preventDefault(); fileSaveAs(); return;
        case 'd': e.preventDefault(); cycleTheme(); return;
      }
    }

    // Formatting shortcuts only apply while the editor is visible.
    if (!editingVisible()) return;

    if (e.altKey && !e.shiftKey) {
      const m = e.code.match(/^Digit([0-6])$/);
      if (m) { e.preventDefault(); applyHeading(Number(m[1])); }
      return;
    }

    if (!e.shiftKey) {
      switch (e.key.toLowerCase()) {
        case 'b': e.preventDefault(); toggleInline('**'); return;
        case 'i': e.preventDefault(); toggleInline('*'); return;
        case 'e': e.preventDefault(); toggleInline('`'); return;
        case 'k': e.preventDefault(); insertLink(); return;
      }
      return;
    }

    // Ctrl+Shift+…
    switch (e.code) {
      case 'Digit7': e.preventDefault(); toggleLinePrefix('ol'); return;
      case 'Digit8': e.preventDefault(); toggleLinePrefix('ul'); return;
      case 'Digit9': e.preventDefault(); toggleLinePrefix('task'); return;
    }
    switch (e.key.toLowerCase()) {
      case 'x': e.preventDefault(); toggleInline('~~'); return;
      case 'h': e.preventDefault(); toggleInline('=='); return;
      case 'c': e.preventDefault(); insertCodeBlock(); return;
      case 'q': e.preventDefault(); toggleLinePrefix('quote'); return;
    }
  });

  // ---------------- Window close, file drop, second launch ----------------

  const win = tauri.currentWindow();
  if (win && win.onCloseRequested) {
    win.onCloseRequested(async (event) => {
      captureActive();
      const dirty = docs.filter(docDirty);
      if (!dirty.length) return;
      const what = dirty.length === 1
        ? `${baseName(dirty[0].path)} has unsaved changes.`
        : `${dirty.length} documents have unsaved changes.`;
      const close = await tauri.ask(`${what} Close without saving?`,
        { title: 'Glance', kind: 'warning' });
      if (!close) event.preventDefault();
    });
  }

  const webview = tauri.currentWebview();
  if (webview && webview.onDragDropEvent) {
    webview.onDragDropEvent(async (event) => {
      const payload = event.payload;
      if (!payload || payload.type !== 'drop' || !payload.paths || !payload.paths.length) return;
      for (const p of payload.paths.filter((x) => MD_EXT_RE.test(x))) {
        await openPath(p);
      }
    });
  }

  // A second launch (double-clicking another .md in Explorer) hands its path
  // to this window rather than starting a second copy of the app.
  if (tauri.listen) {
    tauri.listen('open-file', (event) => {
      const path = typeof event.payload === 'string' ? event.payload : null;
      if (path) openPath(path, { focusEditor: false });
    });
  }

  // ---------------- Startup ----------------

  async function init() {
    applyTheme();
    let launchPath = null;
    if (tauri.available) {
      try { launchPath = await tauri.invoke('launch_file_path'); } catch (e) {}
    }
    // Seed an empty doc so there is always exactly one active document.
    docs = [makeDoc(null, '')];
    activeId = docs[0].id;
    editor.value = '';

    const opened = launchPath ? await openPath(launchPath) : false;
    if (opened) {
      // Opened with a file (double-click in Explorer): reading is the intent.
      setView('read');
    } else {
      // Blank start — or the launch file was unreadable, in which case read
      // view would just be an empty page with the editing tools hidden.
      setView('edit');
    }
    renderTabs();
    updateTitle();
    if (window.__showAppWindow) window.__showAppWindow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
