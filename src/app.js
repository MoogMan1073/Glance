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
    windowLabel: () => {
      try { return T ? T.window.getCurrentWindow().label : 'main'; }
      catch (e) { return 'main'; }
    },
    currentWebview: () => (T && T.webview) ? T.webview.getCurrentWebview() : null,
  };

  const MD_FILTERS = [
    { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
    { name: 'Text', extensions: ['txt'] },
    { name: 'All files', extensions: ['*'] },
  ];
  const MD_EXT_RE = /\.(md|markdown|mdown|mkd|txt)$/i;

  // ---------------- Elements ----------------

  // `editor` is whichever document's textarea is on screen; activate() swaps it.
  let editor = null;
  const editorPane = document.getElementById('editorPane');
  const readOnlyBanner = document.getElementById('readOnlyBanner');
  const preview = document.getElementById('preview');
  const previewPane = document.getElementById('previewPane');
  const helpPanel = document.getElementById('helpPanel');
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

  // Each document gets its own textarea rather than sharing one and swapping
  // .value. A textarea's undo stack, caret and scroll position belong to the
  // element: give every document its own and all three survive a tab switch
  // for free. Reusing one would reset undo history on every switch.
  // Why a document opened read-only. One sentence, shown in the banner and
  // repeated by the save refusal, so the two cannot describe it differently.
  const LOSSY_READ =
    'Read-only: this file contains bytes that are not valid UTF-8, and they were '
    + 'read as \u{FFFD}. Saving would write those substitutes over the original and '
    + 'the bytes would be gone. Use Save As to write a copy.';

  function createEditorEl(doc) {
    const ta = document.createElement('textarea');
    ta.className = 'editor';
    ta.spellcheck = false;
    ta.placeholder = '# Start writing Markdown…';
    ta.setAttribute('aria-label', 'Markdown editor');
    ta.value = doc.content;
    ta.hidden = true;
    // The textarea itself refuses the keystroke, so the document cannot become
    // dirty in the first place — a guard only at save would let somebody type
    // for an hour and then be told.
    ta.readOnly = !!doc.readOnly;
    attachEditorListeners(ta);
    editorPane.appendChild(ta);
    return ta;
  }

  function makeDoc(path, content, readOnly) {
    const doc = {
      id: ++seq,
      path: path || null,
      content: content || '',
      savedContent: content || '',
      editorScroll: 0,
      previewScroll: 0,
      liveScroll: 0,
      html: null,       // cached render; null means stale
      groups: null,     // cached live-view block map; null means stale
      dirtyShown: null, // last dirty state drawn in the tab strip
      // The REASON rather than a flag, because it is what the banner and the
      // refusal both print. A boolean would need a second table saying why.
      readOnly: readOnly || null,
      el: null,
    };
    doc.el = createEditorEl(doc);
    return doc;
  }

  function renderReadOnlyBanner() {
    const d = activeDoc();
    const reason = d && d.readOnly;
    readOnlyBanner.textContent = reason || '';
    readOnlyBanner.hidden = !reason;
  }

  const activeDoc = () => docs.find((d) => d.id === activeId) || null;
  const docDirty = (d) => !!d && d.content !== d.savedContent;
  const isDirty = () => docDirty(activeDoc());
  const findByPath = (path) => docs.find((d) => d.path === path) || null;

  // The caret lives in the doc's own textarea and survives on its own, but
  // scroll does not: a hidden element loses scrollTop, and focus() then jumps
  // to wherever the caret is. So scroll is tracked here and restored by hand.
  // Reading scrollTop from a pane that is currently display:none returns 0,
  // which would wipe the stored value — only record what is actually visible.
  function captureActive() {
    const d = activeDoc();
    if (!d || !editor) return;
    const view = document.body.dataset.view;
    d.content = editor.value;
    // In live view the editor is a peephole scrolled to the caret's block and
    // the pane does the scrolling, so neither value means what it does elsewhere.
    if (view === 'live') d.liveScroll = editorPane.scrollTop;
    else if (view !== 'read') d.editorScroll = editor.scrollTop;
    if (view === 'split' || view === 'read') d.previewScroll = previewPane.scrollTop;
  }

  function restoreScrollPositions() {
    const d = activeDoc();
    if (!d) return;
    const view = document.body.dataset.view;
    if (view === 'live') editorPane.scrollTop = d.liveScroll;
    else if (view !== 'read' && editor) editor.scrollTop = d.editorScroll;
    if (view === 'split' || view === 'read') previewPane.scrollTop = d.previewScroll;
  }

  // Focus belongs wherever the user can act: the editor, or the reading pane
  // (which needs focus for PageDown and the arrow keys to scroll it).
  function restoreFocus() {
    if (!helpOverlay.hidden) return;
    if (document.body.dataset.view === 'read') previewPane.focus();
    else if (editor) editor.focus();
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

  // Which document's HTML is currently sitting in the preview DOM. Tracking
  // only per-doc cache staleness is not enough: a warm cache would let the
  // pane keep showing whichever document was rendered into it last.
  let renderedId = null;

  function renderPreview(restoreScroll) {
    const d = activeDoc();
    if (!d) return;
    if (d.html === null) d.html = md.render(d.content, { basePath: d.path });
    preview.innerHTML = d.html;
    renderedId = d.id;
    if (restoreScroll) previewPane.scrollTop = d.previewScroll;
  }

  function previewStale() {
    const d = activeDoc();
    return !!d && (d.html === null || renderedId !== d.id);
  }

  let renderTimer = null;
  function scheduleRender() {
    const d = activeDoc();
    if (d) { d.html = null; d.groups = null; }
    if (liveOn()) { liveSchedule(); return; }
    if (document.body.dataset.view === 'edit') return; // render lazily when preview becomes visible
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { if (previewStale()) renderPreview(false); }, 120);
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

  function renderTabs(scrollActiveIntoView) {
    document.body.dataset.tabs = docs.length > 1 ? 'many' : 'single';
    for (const d of docs) d.dirtyShown = docDirty(d);
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
      // Only chase the active tab when it actually changed — doing it on every
      // repaint would yank a scrolled strip back while the user is typing.
      if (d.id === activeId && docs.length > 1 && scrollActiveIntoView) {
        requestAnimationFrame(() => tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      }
    }
  }

  // ---------------- Tab operations ----------------

  function showDoc(d) {
    if (editor && editor !== d.el) {
      liveUnstyle(editor);   // live view leaves geometry on the element it used
      editor.hidden = true;
      editor.removeAttribute('id');
    }
    activeId = d.id;
    editor = d.el;
    editor.hidden = false;
    editor.id = 'editor';   // the active textarea always carries the id
    // Here rather than in each caller: every route that changes which document
    // is on screen goes through showDoc, and a banner left over from the tab
    // before would be a sentence about a file the user is no longer looking at.
    renderReadOnlyBanner();
  }

  function activate(id, focusEditor) {
    if (id === activeId) return;
    captureActive();
    clearBlock();
    const d = docs.find((x) => x.id === id);
    if (!d) return;
    showDoc(d);
    if (liveOn()) liveSync();
    else if (document.body.dataset.view !== 'edit') renderPreview(true);
    renderTabs(true);
    updateTitle();
    updateHeadingSelect();
    if (focusEditor !== false) restoreFocus();
    restoreScrollPositions();   // after focus, which scrolls the caret into view
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
    const doc = makeDoc(path, content, opts.readOnly);
    const cur = activeDoc();
    if (opts.replaceDisposable !== false && isDisposable(cur)) {
      docs.splice(docs.indexOf(cur), 1);
      if (cur.el) cur.el.remove();
    }
    docs.push(doc);
    showDoc(doc);
    previewPane.scrollTop = 0;
    if (liveOn()) liveSync();
    else if (document.body.dataset.view !== 'edit') renderPreview(false);
    renderTabs(true);
    updateTitle();
    updateHeadingSelect();
    if (opts.focusEditor !== false) restoreFocus();
    return doc;
  }

  // Closes with a confirmation dialog open are re-entrant: the click, the
  // middle-click and Ctrl+W all reach here, and the dialog can stay up for as
  // long as the user takes to answer. Without a guard a second request for the
  // same document gets its own prompt and then splices a stale index.
  const closingIds = new Set();

  // Removing a document from this window, once the decision to do so is made.
  // Shared by closing a tab and moving one to its own window: the bookkeeping
  // is identical, only the question asked beforehand differs.
  function removeDoc(d) {
    const idx = docs.indexOf(d);
    if (idx === -1) return false;
    docs.splice(idx, 1);

    if (!docs.length) {
      // Last tab gone: nothing left to show, so the window goes with it.
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
      renderTabs(false);
      // The close button that had focus was just destroyed; without this the
      // next keystrokes would go nowhere.
      restoreFocus();
    }
    if (d.el) d.el.remove();
    return true;
  }

  async function closeDoc(id) {
    if (closingIds.has(id)) return false;
    const d = docs.find((x) => x.id === id);
    if (!d) return false;
    closingIds.add(id);
    try {
      if (d.id === activeId) captureActive();
      if (docDirty(d)) {
        const ok = await tauri.ask(
          `${baseName(d.path)} has unsaved changes. Close it anyway?`,
          { title: 'Glance', kind: 'warning' }
        );
        if (!ok) return false;
      }
      // Re-find rather than trusting an index taken before the await: if this
      // document is already gone, indexOf returns -1 and splice(-1, 1) would
      // delete an unrelated tab along with its unsaved work.
      return removeDoc(d);
    } finally {
      closingIds.delete(id);
    }
  }

  // Move a document into a window of its own. Unsaved text travels with it, so
  // there is nothing to confirm — the document is not being discarded, and
  // asking "are you sure?" for a move would be noise.
  async function detachDoc(id, screenX, screenY) {
    if (docs.length < 2) return false;   // a lone tab already is its own window
    const d = docs.find((x) => x.id === id);
    if (!d || closingIds.has(id)) return false;
    if (d.id === activeId) captureActive();
    closingIds.add(id);
    try {
      await tauri.invoke('open_in_new_window', {
        // read_only travels too. A torn-off tab that arrived editable would
        // let somebody type into a document this app cannot write back, and
        // the only thing left to catch it would be the backend refusal at
        // save — which is the backstop, not the explanation.
        doc: { path: d.path, content: d.content, saved: d.savedContent, read_only: d.readOnly },
        x: typeof screenX === 'number' ? screenX : null,
        y: typeof screenY === 'number' ? screenY : null,
      });
    } catch (err) {
      showToast(String(err), true);
      return false;
    } finally {
      closingIds.delete(id);
    }
    // Only drop it here once the new window has actually been created.
    return removeDoc(d);
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

  // ---------------- Context menus ----------------
  // One menu implementation with submenu support, shared by the tab strip and
  // the editor. Right-clicking either replaces the webview's own menu, so
  // whatever it took away — cut, copy, paste — has to be offered back here.

  const ctxMenu = document.getElementById('ctxMenu');
  let menuOwner = null;   // the element the open menu belongs to

  const MENU_ICONS = {
    link: 'M6.5 4.4 8.6 2.3a3 3 0 0 1 4.24 0l.86.86a3 3 0 0 1 0 4.24l-2.1 2.1a3 3 0 0 1-1.86.87l.9-1.87 1.99-2.16a1.5 1.5 0 0 0 0-2.12l-.85-.85a1.5 1.5 0 0 0-2.12 0L7.55 5.5l-1.05-1.1zm3 7.2-2.1 2.1a3 3 0 0 1-4.24 0l-.86-.86a3 3 0 0 1 0-4.24l2.1-2.1a3 3 0 0 1 1.86-.87l-.9 1.87-1.99 2.16a1.5 1.5 0 0 0 0 2.12l.85.85a1.5 1.5 0 0 0 2.12 0l2.12-2.12 1.04 1.09zM10.6 4.34 5.4 9.54l1.06 1.06 5.2-5.2-1.06-1.06z',
    format: 'M11.1 2.2a1.9 1.9 0 0 1 2.7 2.7l-7.9 7.9-3.4.7.7-3.4 7.9-7.9zM10 4.4 4.5 9.9l-.3 1.9 1.9-.3L11.6 6 10 4.4z',
    paragraph: 'M8.5 2H12v1.5h-1.5V14H9V3.5H8v10.5H6.5V9.2A3.6 3.6 0 0 1 6.5 2h2zM6.5 3.5a2.1 2.1 0 0 0 0 4.2V3.5z',
    insert: 'M7.25 2.5h1.5v4.75h4.75v1.5H8.75v4.75h-1.5V8.75H2.5v-1.5h4.75V2.5z',
    cut: 'M4 2.2 7.4 7l-.9 1.3-1-.4a2.2 2.2 0 1 0-1 1.9l.9-1.3.9 1.3L4 12.6a2.2 2.2 0 1 0 1.1 1.1l6-8.6-1.2-.9L8 7.1 5.2 3 4 2.2zM3.3 10.9a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0-6.6a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm8.4 6.6 1.1 1.6a2.2 2.2 0 1 1-1.1.8l-1.1-1.6.9-1.3.2.5z',
    copy: 'M5 1.5h6.5a1 1 0 0 1 1 1V10h-1.5V3H5V1.5zM3 4h6.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm.5 1.5v7.5h5.5V5.5h-5.5z',
    paste: 'M6 1.5h4a1 1 0 0 1 1 1V3h1.5a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1H5v-.5a1 1 0 0 1 1-1zm.5 1.5v1h3V3h-3zM4 4.5V13.5h8V4.5h-1v1H5v-1H4z',
    selectAll: 'M2 2h3v1.5H3.5V5H2V2zm9 0h3v3h-1.5V3.5H11V2zM2 11h1.5v1.5H5V14H2v-3zm10.5 0H14v3h-3v-1.5h1.5V11zM6 6h4v4H6V6z',
    bullet: 'M3 3.25a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm3 .25h8v1.5H6V3.5zM3 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm3 .25h8v1.5H6v-1.5zM3 10.75a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm3 .25h8v1.5H6V11z',
    numbered: 'M2.4 2.2h1.1v3.1H2.4V3.4l-.8.3-.3-.9 1.1-.6zM6 3.5h8V5H6V3.5zm0 3.75h8v1.5H6v-1.5zM6 11h8v1.5H6V11zM1.5 8.1c0-.9.7-1.4 1.5-1.4s1.5.5 1.5 1.3c0 .5-.3.9-.7 1.3l-.8.7h1.5v.9h-3v-.8L2.9 8.7c.3-.3.5-.5.5-.7 0-.3-.2-.4-.4-.4-.3 0-.5.2-.5.5h-1z',
    task: 'M2.5 2h4A.5.5 0 0 1 7 2.5v4a.5.5 0 0 1-.5.5h-4A.5.5 0 0 1 2 6.5v-4a.5.5 0 0 1 .5-.5zM3 3v3h3V3H3zm-.5 6.5h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5zM3 10.5v3h3v-3H3zm1.1 2.5L3 11.9l.6-.6.5.5 1.3-1.3.6.6L4.1 13zM9 3.5h5V5H9V3.5zM9 11h5v1.5H9V11z',
    quote: 'M3.5 4A2.5 2.5 0 0 0 1 6.5c0 1.2.85 2.2 2 2.44-.14.9-.62 1.75-1.4 2.31l.9 1.15C4.1 11.2 5 9.6 5 7.75V6.5A1.5 1.5 0 0 0 3.5 4zm7 0A2.5 2.5 0 0 0 8 6.5c0 1.2.85 2.2 2 2.44-.14.9-.62 1.75-1.4 2.31l.9 1.15c1.6-1.2 2.5-2.8 2.5-4.65V6.5A1.5 1.5 0 0 0 10.5 4z',
    code: 'M5.7 3.7 1.4 8l4.3 4.3 1.06-1.06L3.52 8l3.24-3.24L5.7 3.7zm4.6 0-1.06 1.06L12.48 8l-3.24 3.24 1.06 1.06L14.6 8l-4.3-4.3z',
    codeblock: 'M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-11zM3.5 2.5v11h9v-11h-9zM6.8 6 5 8l1.8 2 .9-.8L6.6 8l1.1-1.2L6.8 6zm2.4 0-.9.8L9.4 8l-1.1 1.2.9.8L11 8 9.2 6z',
    table: 'M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9zM3.5 6h9V3.5h-9V6zm4 1.5h-4v2h4v-2zm1.5 0v2h3.5v-2H9zm-1.5 3.5h-4v1.5h4V11zm1.5 1.5h3.5V11H9v1.5z',
    hr: 'M2 7.25h12v1.5H2v-1.5z',
    image: 'M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9zm1.5 0v6.1l2.3-2.3a1 1 0 0 1 1.4 0l1.8 1.8 1.3-1.3a1 1 0 0 1 1.4 0l1.8 1.8V3.5h-11zM10 5a1.2 1.2 0 1 1 0 2.4A1.2 1.2 0 0 1 10 5z',
    body: 'M2 3.5h12V5H2V3.5zm0 3.75h12v1.5H2v-1.5zM2 11h8v1.5H2V11z',
    clear: 'M6.2 3h7.3v1.5H8.9l-1 3.2 5 5-1.06 1.06L2.2 3.86 3.26 2.8 6.2 5.74V3zm-1.4 6.2 1.2 1.2-.7 2.3H3.6l1.2-3.5z',
  };

  const icon = (name) => name && MENU_ICONS[name]
    ? `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${MENU_ICONS[name]}"/></svg>`
    : '<span class="menu-icon-gap"></span>';

  function closeMenu() {
    ctxMenu.hidden = true;
    ctxMenu.textContent = '';
    menuOwner = null;
  }

  const menuOpen = () => !ctxMenu.hidden;

  function buildPanel(items) {
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    panel.setAttribute('role', 'menu');
    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'menu-sep';
        panel.appendChild(sep);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'menu-item';
      btn.setAttribute('role', 'menuitem');
      btn.dataset.label = item.label;   // stable hook for tests and styling
      btn.disabled = !!item.disabled;
      btn.innerHTML =
        icon(item.icon) +
        `<span class="menu-label">${item.label}</span>` +
        (item.submenu ? '<span class="menu-arrow">›</span>'
                      : item.checked ? '<span class="menu-check">✓</span>'
                      : item.accel ? `<span class="menu-accel">${item.accel}</span>` : '');
      if (item.submenu) {
        btn.classList.add('has-submenu');
        btn.setAttribute('aria-haspopup', 'true');
        const open = () => openSubmenu(btn, item.submenu);
        btn.addEventListener('mouseenter', open);
        btn.addEventListener('focus', open);
        btn.addEventListener('click', open);
      } else {
        btn.addEventListener('mouseenter', () => closeSubmenusAfter(panel));
        btn.addEventListener('click', () => { closeMenu(); item.run(); });
      }
      panel.appendChild(btn);
    }
    return panel;
  }

  function closeSubmenusAfter(panel) {
    let next = panel.nextElementSibling;
    while (next) {
      const after = next.nextElementSibling;
      next.remove();
      next = after;
    }
    for (const b of panel.querySelectorAll('.has-submenu')) b.classList.remove('open');
  }

  function openSubmenu(parentBtn, items) {
    const panel = parentBtn.parentElement;
    closeSubmenusAfter(panel);
    parentBtn.classList.add('open');
    const sub = buildPanel(items);
    ctxMenu.appendChild(sub);
    // Sit beside the parent item, flipping to its left edge if there is no
    // room on the right.
    const anchor = parentBtn.getBoundingClientRect();
    const root = ctxMenu.getBoundingClientRect();
    const w = sub.offsetWidth;
    const h = sub.offsetHeight;
    let left = anchor.right - root.left + 2;
    if (anchor.right + w + 6 > window.innerWidth) left = anchor.left - root.left - w - 2;
    let top = anchor.top - root.top - 4;
    if (anchor.top + h + 6 > window.innerHeight) {
      top = Math.max(-root.top + 4, window.innerHeight - h - 6 - root.top);
    }
    sub.style.left = left + 'px';
    sub.style.top = top + 'px';
  }

  function showMenu(items, x, y, owner) {
    closeMenu();
    menuOwner = owner || null;
    const root = buildPanel(items);
    root.classList.add('menu-root');
    ctxMenu.appendChild(root);
    ctxMenu.hidden = false;
    // Place at the cursor, pulled back inside the window if it would overflow.
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    ctxMenu.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 6)) + 'px';
    ctxMenu.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 6)) + 'px';
  }

  window.addEventListener('pointerdown', (e) => {
    if (menuOpen() && !e.target.closest('#ctxMenu')) closeMenu();
  }, true);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('keydown', (e) => {
    if (menuOpen() && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
  }, true);

  // ---------------- Clipboard ----------------
  // The webview's own menu is suppressed for our own, so these have to work.
  // execCommand keeps cut and copy inside the textarea's undo history; reading
  // the clipboard needs a real API, and Tauri's plugin is the dependable one.

  async function clipboardRead() {
    try {
      if (T && T.clipboardManager) return (await T.clipboardManager.readText()) || '';
    } catch (e) { /* fall through */ }
    try {
      if (navigator.clipboard && navigator.clipboard.readText) return await navigator.clipboard.readText();
    } catch (e) { /* fall through */ }
    return null;
  }

  function editorCut() {
    if (!editor) return;
    editor.focus();
    if (!document.execCommand('cut')) showToast('Could not cut', true);
  }

  function editorCopy() {
    if (!editor) return;
    editor.focus();
    if (!document.execCommand('copy')) showToast('Could not copy', true);
  }

  async function editorPaste() {
    if (!editor) return;
    const text = await clipboardRead();
    if (text === null) { showToast('Could not read the clipboard', true); return; }
    if (!text) return;
    editor.focus();
    replaceRange(editor.selectionStart, editor.selectionEnd, text);
  }

  function selectAll() {
    if (!editor) return;
    clearBlock();
    editor.focus();
    editor.setSelectionRange(0, editor.value.length);
  }

  // Strip inline markers from the selection — Obsidian's "clear formatting".
  function clearFormatting() {
    if (!editor) return;
    const s = editor.selectionStart;
    const e = editor.selectionEnd;
    if (s === e) return;
    const original = editor.value.slice(s, e);
    let text = original;
    let prev;
    do {
      prev = text;
      text = text
        .replace(/\*\*\*([\s\S]+?)\*\*\*/g, '$1')
        .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
        .replace(/(?<!\*)\*(?!\*)([\s\S]+?)(?<!\*)\*(?!\*)/g, '$1')
        .replace(/___([\s\S]+?)___/g, '$1')
        .replace(/__([\s\S]+?)__/g, '$1')
        .replace(/~~([\s\S]+?)~~/g, '$1')
        .replace(/==([\s\S]+?)==/g, '$1')
        .replace(/`([^`\n]+?)`/g, '$1');
    } while (text !== prev);
    if (text !== original) replaceRange(s, e, text, s, s + text.length);
  }

  // ---------------- Editor context menu ----------------

  function editorMenuItems() {
    const level = currentLineHeadingLevel();
    const heading = (n) => ({
      label: n === 0 ? 'Body' : `Heading ${n}`,
      icon: n === 0 ? 'body' : null,
      checked: level === n,
      run: () => applyHeading(n),
    });
    return [
      { label: 'Add link', icon: 'link', accel: 'Ctrl+K', run: insertLink },
      { separator: true },
      {
        label: 'Format', icon: 'format', submenu: [
          { label: 'Bold', accel: 'Ctrl+B', run: () => toggleInline('**') },
          { label: 'Italic', accel: 'Ctrl+I', run: () => toggleInline('*') },
          { label: 'Strikethrough', accel: 'Ctrl+Shift+X', run: () => toggleInline('~~') },
          { label: 'Highlight', accel: 'Ctrl+Shift+H', run: () => toggleInline('==') },
          { separator: true },
          { label: 'Code', icon: 'code', accel: 'Ctrl+E', run: () => toggleInline('`') },
          { label: 'Code block', icon: 'codeblock', accel: 'Ctrl+Shift+C', run: insertCodeBlock },
          { separator: true },
          { label: 'Clear formatting', icon: 'clear', run: clearFormatting },
        ],
      },
      {
        label: 'Paragraph', icon: 'paragraph', submenu: [
          { label: 'Bullet list', icon: 'bullet', accel: 'Ctrl+Shift+8', run: () => toggleLinePrefix('ul') },
          { label: 'Numbered list', icon: 'numbered', accel: 'Ctrl+Shift+7', run: () => toggleLinePrefix('ol') },
          { label: 'Task list', icon: 'task', accel: 'Ctrl+Shift+9', run: () => toggleLinePrefix('task') },
          { separator: true },
          heading(1), heading(2), heading(3), heading(4), heading(5), heading(6), heading(0),
          { separator: true },
          { label: 'Quote', icon: 'quote', accel: 'Ctrl+Shift+Q', run: () => toggleLinePrefix('quote') },
        ],
      },
      {
        label: 'Insert', icon: 'insert', submenu: [
          { label: 'Table', icon: 'table', run: insertTable },
          { label: 'Horizontal rule', icon: 'hr', run: () => insertBlock('---\n') },
          { label: 'Image', icon: 'image', run: () => insertSnippet('![', 'alt text', '](url)') },
        ],
      },
      { separator: true },
      { label: 'Cut', icon: 'cut', accel: 'Ctrl+X', disabled: !hasSelection(), run: editorCut },
      { label: 'Copy', icon: 'copy', accel: 'Ctrl+C', disabled: !hasSelection(), run: editorCopy },
      { label: 'Paste', icon: 'paste', accel: 'Ctrl+V', run: editorPaste },
      { separator: true },
      { label: 'Select all', icon: 'selectAll', accel: 'Ctrl+A', run: selectAll },
    ];
  }

  const hasSelection = () => !!editor && editor.selectionStart !== editor.selectionEnd;

  // ---------------- Tab context menu ----------------

  function tabMenuItems(id) {
    return [
      // A lone document already has a window to itself.
      { label: 'Move to New Window', disabled: docs.length < 2, run: () => detachDoc(id) },
      { separator: true },
      { label: 'Close', run: () => closeDoc(id) },
      {
        label: 'Close Others', disabled: docs.length < 2, run: async () => {
          for (const other of docs.slice()) {
            if (other.id !== id) await closeDoc(other.id);
          }
        },
      },
    ];
  }

  tabbar.addEventListener('contextmenu', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    e.preventDefault();   // the webview's own menu has nothing useful here
    showMenu(tabMenuItems(Number(tab.dataset.id)), e.clientX, e.clientY, tab);
  });

  // ---------------- Drag a tab out into its own window ----------------
  // Pointer events rather than HTML5 drag-and-drop: with the pointer captured
  // the coordinates keep arriving once the cursor leaves the window, which is
  // exactly the gesture being detected.

  let drag = null;

  const outsideWindow = (e) =>
    e.clientX < 0 || e.clientY < 0 ||
    e.clientX > window.innerWidth || e.clientY > window.innerHeight;

  function endDrag() {
    if (drag && drag.tab) drag.tab.removeAttribute('data-dragging');
    document.body.classList.remove('detaching');
    drag = null;
  }

  tabbar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.tab-close')) return;
    const tab = e.target.closest('.tab');
    if (!tab || docs.length < 2) return;
    drag = { id: Number(tab.dataset.id), x: e.clientX, y: e.clientY, tab, moved: false };
    try { tab.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
  });

  tabbar.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && (Math.abs(e.clientX - drag.x) > 6 || Math.abs(e.clientY - drag.y) > 6)) {
      drag.moved = true;
      drag.tab.dataset.dragging = 'true';
    }
    if (drag.moved) document.body.classList.toggle('detaching', outsideWindow(e));
  });

  tabbar.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const { id, moved } = drag;
    const detach = moved && outsideWindow(e);
    const screenX = e.screenX;
    const screenY = e.screenY;
    endDrag();
    // Released outside the window: that document wants a window of its own,
    // placed where it was dropped.
    if (detach) detachDoc(id, screenX, screenY);
  });

  tabbar.addEventListener('pointercancel', endDrag);

  // Autoscroll is armed on mousedown, so suppressing it at auxclick is too
  // late — the strip scrolls horizontally and would start panning.
  tabbar.addEventListener('mousedown', (e) => {
    if (e.button === 1 && e.target.closest('.tab')) e.preventDefault();
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

  const VIEWS = ['edit', 'split', 'read', 'live'];

  function setView(view) {
    if (!VIEWS.includes(view)) return;
    captureActive();   // record scroll before a pane is hidden and loses it
    clearBlock();
    const prev = document.body.dataset.view;
    document.body.dataset.view = view;
    for (const v of VIEWS) {
      document.getElementById('btn-view-' + v).classList.toggle('active', v === view);
    }
    if (prev === 'live' && view !== 'live') liveUnstyle(editor);
    if (view === 'live') liveSync();
    else if (view !== 'edit' && previewStale()) renderPreview(prev === 'edit');
    restoreFocus();
    restoreScrollPositions();
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
    // execCommand honours readOnly; setRangeText does not. So the fallback
    // below is a way around the textarea's own refusal, and every toolbar
    // button, formatting hotkey and live-view checkbox reaches it. Refusing
    // here, where all of those meet, is what keeps "cannot become dirty in the
    // first place" true for routes that are not keystrokes.
    if (editor.readOnly) {
      const d = activeDoc();
      showToast((d && d.readOnly) || 'This document is read-only', true);
      return;
    }
    clearBlock();
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

  // ---------------- Column (block) selection ----------------
  // Alt+drag selects a rectangle, the way Notepad++ and the IDEs do. A
  // textarea has exactly one selection range, so the rectangle is modelled
  // here and drawn ourselves, and edits are replayed range by range.
  //
  // Geometry comes from #selMirror, which reproduces the textarea's box and
  // typography and holds the same text. A Range over it reports where a
  // character actually sits, so soft wrap and tabs are handled by the same
  // layout engine that draws the real thing rather than by arithmetic.

  const selMirror = document.getElementById('selMirror');
  const selOverlay = document.getElementById('selOverlay');

  let block = null;        // {anchor:{line,col}, head:{line,col}}
  let blockDragging = false;
  // Our own execCommand calls re-fire beforeinput on the same textarea; without
  // this the interceptor would recurse into itself.
  let applyingBlock = false;

  const MIRROR_KEYS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'textIndent', 'whiteSpace', 'overflowWrap', 'wordBreak', 'tabSize',
  ];

  function syncMirror() {
    if (!editor) return null;
    const cs = getComputedStyle(editor);
    for (const k of MIRROR_KEYS) selMirror.style[k] = cs[k];
    selMirror.style.boxSizing = 'border-box';
    selMirror.style.width = editor.clientWidth + 'px';
    // Match the textarea's scroll so mirror rects land where the text is drawn.
    selMirror.style.transform = `translateY(${-editor.scrollTop}px)`;
    if (selMirror.textContent !== editor.value) selMirror.textContent = editor.value;
    return selMirror.firstChild;
  }

  function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    return starts;
  }

  const lineEndAt = (text, starts, i) =>
    i + 1 < starts.length ? starts[i + 1] - 1 : text.length;

  // Rectangle of the character at `col` on `line`; zero-width at the line's end.
  // Assumes syncMirror() has already run for this gesture — it is called from
  // binary searches, so re-syncing here would restyle the mirror per probe.
  function charRect(line, col) {
    const node = selMirror.firstChild;
    const text = editor.value;
    const starts = lineStarts(text);
    if (line >= starts.length) line = starts.length - 1;
    const s = starts[line];
    const len = lineEndAt(text, starts, line) - s;
    const r = document.createRange();
    if (!node) {
      const b = selMirror.getBoundingClientRect();
      return new DOMRect(b.left, b.top, 0, 0);
    }
    if (col < len) {
      r.setStart(node, s + col);
      r.setEnd(node, s + col + 1);
      return r.getBoundingClientRect();
    }
    if (len === 0) {
      // Empty line: measure its newline, which sits at the line's start.
      if (s < text.length) {
        r.setStart(node, s);
        r.setEnd(node, s + 1);
        const q = r.getBoundingClientRect();
        return new DOMRect(q.left, q.top, 0, q.height);
      }
      const b = selMirror.getBoundingClientRect();
      return new DOMRect(b.left, b.top, 0, 0);
    }
    r.setStart(node, s + len - 1);
    r.setEnd(node, s + len);
    const q = r.getBoundingClientRect();
    return new DOMRect(q.right, q.top, 0, q.height);   // just past the last character
  }

  // Which line/column sits under a point, in reading order.
  function pointToLineCol(clientX, clientY) {
    syncMirror();
    const text = editor.value;
    const starts = lineStarts(text);
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const rect = charRect(mid, 0);
      const bottom = rect.height ? rect.bottom : rect.top;
      if (bottom <= clientY) lo = mid + 1; else hi = mid;
    }
    // A wrapped line spans several rows, so step back while the point sits
    // below this line's first row but still inside the previous line.
    let line = lo;
    while (line > 0) {
      const prev = charRect(line - 1, 0);
      const here = charRect(line, 0);
      if (here.top <= clientY || prev.bottom > clientY) break;
      line -= 1;
    }
    const len = lineEndAt(text, starts, line) - starts[line];
    let a = 0, b = len;
    while (a < b) {
      const mid = (a + b) >> 1;
      const r = charRect(line, mid);
      let before;
      if (r.height && r.bottom <= clientY) before = true;
      else if (r.height && r.top > clientY) before = false;
      else before = (r.left + r.right) / 2 <= clientX;
      if (before) a = mid + 1; else b = mid;
    }
    return { line, col: a };
  }

  function normBlock() {
    const l0 = Math.min(block.anchor.line, block.head.line);
    const l1 = Math.max(block.anchor.line, block.head.line);
    const c0 = Math.min(block.anchor.col, block.head.col);
    const c1 = Math.max(block.anchor.col, block.head.col);
    return { l0, l1, c0, c1 };
  }

  // The block as concrete offset ranges, clamped to each line's length.
  function blockRanges() {
    const text = editor.value;
    const starts = lineStarts(text);
    const { l0, l1, c0, c1 } = normBlock();
    const out = [];
    for (let line = l0; line <= l1 && line < starts.length; line++) {
      const s = starts[line];
      const len = lineEndAt(text, starts, line) - s;
      out.push({
        line,
        lineStart: s,
        lineEnd: s + len,
        start: s + Math.min(c0, len),
        end: s + Math.min(c1, len),
      });
    }
    return out;
  }

  function renderBlock() {
    selOverlay.textContent = '';
    if (!block || !editor || document.body.dataset.view === 'read') return;
    const node = syncMirror();
    if (!node) return;
    const origin = selOverlay.getBoundingClientRect();
    const text = editor.value;
    const starts = lineStarts(text);
    const { l0, l1, c0, c1 } = normBlock();
    for (let line = l0; line <= l1 && line < starts.length; line++) {
      const s = starts[line];
      const len = lineEndAt(text, starts, line) - s;
      if (c0 === c1) {
        const p = charRect(line, Math.min(c0, len));
        const el = document.createElement('div');
        el.className = 'block-caret';
        el.style.left = (p.left - origin.left) + 'px';
        el.style.top = (p.top - origin.top) + 'px';
        el.style.height = (p.height || parseFloat(getComputedStyle(editor).lineHeight) || 16) + 'px';
        selOverlay.appendChild(el);
        continue;
      }
      const a = Math.min(c0, len);
      const b = Math.min(c1, len);
      if (b <= a) continue;   // this line is too short to reach the column range
      const r = document.createRange();
      r.setStart(node, s + a);
      r.setEnd(node, s + b);
      for (const q of r.getClientRects()) {
        if (!q.width) continue;
        const el = document.createElement('div');
        el.className = 'block-rect';
        el.style.left = (q.left - origin.left) + 'px';
        el.style.top = (q.top - origin.top) + 'px';
        el.style.width = q.width + 'px';
        el.style.height = q.height + 'px';
        selOverlay.appendChild(el);
      }
    }
  }

  function clearBlock() {
    if (!block) return;
    block = null;
    selOverlay.textContent = '';
  }

  const blockActive = () => !!block;

  // Park the real caret at the block's head so the native highlight does not
  // argue with the one we drew.
  function afterBlockEdit() {
    syncMirror();
    const text = editor.value;
    const starts = lineStarts(text);
    const { l1, c0 } = normBlock();
    const line = Math.min(l1, starts.length - 1);
    const len = lineEndAt(text, starts, line) - starts[line];
    const off = starts[line] + Math.min(c0, len);
    editor.setSelectionRange(off, off);
    renderBlock();
  }

  // The whole affected span is rebuilt and written back as ONE edit. Applying
  // each line separately would work, but it would also push one entry per line
  // onto the undo stack — so a block edit across twelve lines would take twelve
  // presses of Ctrl+Z to undo. A single execCommand keeps it to one.
  function writeSpan(ranges, perLine) {
    if (!ranges.length) return;
    const text = editor.value;
    const from = ranges[0].start;
    const to = ranges[ranges.length - 1].end;
    let out = '';
    let cursor = from;
    ranges.forEach((r, i) => {
      out += text.slice(cursor, r.start);
      out += Array.isArray(perLine) ? (perLine[i] || '') : perLine;
      cursor = r.end;
    });
    out += text.slice(cursor, to);
    if (to === from && !out) return;   // nothing to do
    applyingBlock = true;
    try {
      editor.setSelectionRange(from, to);
      if (!out) document.execCommand('delete');
      else document.execCommand('insertText', false, out);
    } finally {
      applyingBlock = false;
    }
  }

  function replaceBlock(perLine) {
    writeSpan(blockRanges(), perLine);
  }

  function typeIntoBlock(text) {
    const { l0, l1, c0 } = normBlock();
    replaceBlock(text);
    const col = c0 + text.length;
    block = { anchor: { line: l0, col }, head: { line: l1, col } };
    afterBlockEdit();
  }

  function deleteBlock(backwards) {
    const { l0, l1, c0, c1 } = normBlock();
    const wide = c1 > c0;
    let ranges = blockRanges();
    if (!wide) {
      // A zero-width block deletes one character per line instead.
      ranges = ranges.map((r) => {
        if (backwards) return r.start > r.lineStart ? { ...r, start: r.start - 1 } : r;
        return r.end < r.lineEnd ? { ...r, end: r.end + 1 } : r;
      });
    }
    if (!ranges.some((r) => r.end > r.start)) return;
    writeSpan(ranges, '');
    const col = wide ? c0 : (backwards ? Math.max(0, c0 - 1) : c0);
    block = { anchor: { line: l0, col }, head: { line: l1, col } };
    afterBlockEdit();
  }

  const blockWide = () => { const { c0, c1 } = normBlock(); return c1 > c0; };

  const blockText = () => {
    const text = editor.value;
    return blockRanges().map((r) => text.slice(r.start, r.end)).join('\n');
  };

  // ---- Pointer gesture ----

  function beginBlockDrag(e) {
    syncMirror();
    const pos = pointToLineCol(e.clientX, e.clientY);
    block = { anchor: pos, head: pos };
    blockDragging = true;
    renderBlock();
    const off = lineStarts(editor.value)[pos.line] + pos.col;
    editor.setSelectionRange(off, off);
  }

  window.addEventListener('pointermove', (e) => {
    if (!blockDragging || !editor) return;
    block.head = pointToLineCol(e.clientX, e.clientY);
    renderBlock();
  });

  window.addEventListener('pointerup', () => { blockDragging = false; });

  // ---- Keeping the drawing honest ----

  window.addEventListener('resize', () => { if (block) renderBlock(); });

  // ---------------- Live view ----------------
  // The document rendered, with the block the caret is in opened back into raw
  // Markdown — Obsidian's live preview, built from the pieces already here.
  //
  // The textarea is never moved, re-parented, or assigned .value:
  // docs/live-preview-notes.md records that re-parenting a textarea destroys
  // its native undo stack, which rules out any design where an editor migrates
  // to the block being edited. Instead the textarea is shrunk to a peephole —
  // positioned over the gap the active block leaves behind, as tall as that
  // block's source lines, and scrolled internally so exactly those lines show.
  // You are always typing into a real textarea holding the whole document, so
  // undo, IME, spellcheck, the toolbar and every hotkey work untouched, and the
  // caret is never anywhere but in source text: there is no caret-in-rendered-
  // DOM mapping to get wrong. Only clicks need mapping, and only one way.

  const liveLayer = document.getElementById('liveLayer');

  let liveShown = [];      // the groups currently in the DOM, with their elements
  let liveGaps = [];       // block elements currently opened as the gap
  let liveDocId = null;    // whose blocks those are
  let liveLines = -1;      // line count the column in the DOM was built from
  let liveFrame = 0;       // pending rAF, so a burst of events lays out once
  let liveTimer = null;    // deferred rebuild of the rendered column

  function liveOn() { return document.body.dataset.view === 'live'; }

  // Cut the token stream into top-level blocks, each carrying the source lines
  // it came from. markdown-it hands us token.map for free; the work is grouping
  // nested tokens back under their opener, and covering the lines no token
  // claims, so every line of the document belongs to exactly one block.
  function liveBuild(d) {
    if (d.groups) return d.groups;
    const env = { basePath: d.path };
    const lines = d.content.split('\n');
    const toks = md.parse(d.content, env);
    const mapped = [];
    const trailing = [];   // footnote definitions: moved to the end, no map
    let depth = 0;
    let cur = null;
    for (const t of toks) {
      if (!cur) cur = { from: null, to: null, toks: [] };
      cur.toks.push(t);
      if (t.map) {
        if (cur.from === null || t.map[0] < cur.from) cur.from = t.map[0];
        if (cur.to === null || t.map[1] > cur.to) cur.to = t.map[1];
      }
      depth += t.nesting;
      if (depth <= 0) {
        (cur.from === null ? trailing : mapped).push(cur);
        cur = null;
        depth = 0;
      }
    }
    if (cur) (cur.from === null ? trailing : mapped).push(cur);

    // Rendering every block again on every keystroke is what makes this
    // expensive on a long document, and all but one block is unchanged. Keyed
    // by source text, so a block that merely moved down a line is still a hit.
    // Footnotes number themselves from their position in the document, so a
    // document using them renders in full rather than from stale numbering.
    const reuse = env.footnotes ? null : (d.groupCache || new Map());
    const cache = new Map();
    const groups = [];
    const add = (from, to, toks) => {
      let html = '';
      if (toks && from === null) {
        html = md.renderer.render(toks, md.options, env);   // footnote tail: no lines to key on
      } else if (toks) {
        const key = lines.slice(from, to).join('\n');
        html = reuse ? reuse.get(key) : undefined;
        if (html === undefined) html = md.renderer.render(toks, md.options, env);
        cache.set(key, html);
      }
      groups.push({ from, to, html, el: null });
    };
    let line = 0;
    for (const g of mapped) {
      // A list swallows the blank line that follows it. Left in, that line
      // would open a gap taller than the source it reveals.
      let to = g.to;
      while (to > g.from + 1 && !lines[to - 1].trim()) to -= 1;
      if (g.from > line) add(line, g.from, null);   // blank lines between blocks
      add(g.from, to, g.toks);
      line = to;
    }
    if (line < lines.length) add(line, lines.length, null);
    for (const g of trailing) add(null, null, g.toks);
    d.groupCache = env.footnotes ? null : cache;
    d.groups = groups;
    return groups;
  }

  // Replace only the blocks whose HTML actually changed. Rebuilding the column
  // on every keystroke would restart every image load and lose the reveal.
  function livePatch(groups) {
    const prev = liveShown;
    let a = 0;
    while (a < prev.length && a < groups.length && prev[a].html === groups[a].html) {
      groups[a].el = prev[a].el;
      a += 1;
    }
    let b = 0;
    while (a + b < prev.length && a + b < groups.length &&
           prev[prev.length - 1 - b].html === groups[groups.length - 1 - b].html) {
      groups[groups.length - 1 - b].el = prev[prev.length - 1 - b].el;
      b += 1;
    }
    for (let i = a; i < prev.length - b; i++) prev[i].el.remove();
    const anchor = b > 0 ? groups[groups.length - b].el : null;
    const frag = document.createDocumentFragment();
    for (let i = a; i < groups.length - b; i++) {
      const el = document.createElement('div');
      el.className = 'live-block';
      el.innerHTML = groups[i].html;
      // Rendered task boxes come out disabled, which also makes them unclickable.
      // Ticking one off without leaving the rendered view is the whole point here.
      for (const box of el.querySelectorAll('input.task-list-item-checkbox')) {
        box.disabled = false;
      }
      groups[i].el = el;
      frag.appendChild(el);
    }
    liveLayer.insertBefore(frag, anchor);
    liveShown = groups;
  }

  function liveCloseGaps() {
    for (const el of liveGaps) {
      el.classList.remove('live-gap');
      el.style.height = '';
    }
    liveGaps = [];
  }

  // Undo everything live view does to a textarea, so it can go back to being
  // an ordinary full-pane editor.
  function liveUnstyle(ta) {
    liveCloseGaps();
    if (!ta) return;
    ta.style.top = '';
    ta.style.height = '';
    ta.style.display = '';
    ta.scrollTop = 0;
  }

  const liveIndexAt = (groups, line) => groups.findIndex(
    (g) => g.from !== null && line >= g.from && line < g.to
  );

  function lineIndexAt(starts, offset) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // Open the caret's block (or every block the selection touches) and put the
  // editor over the hole it leaves.
  function liveLayout() {
    const groups = liveShown;
    if (!editor || !groups.length) return;
    const text = editor.value;
    const starts = lineStarts(text);
    let i0 = liveIndexAt(groups, lineIndexAt(starts, editor.selectionStart));
    let i1 = liveIndexAt(groups, lineIndexAt(starts, editor.selectionEnd));
    if (i0 < 0) i0 = i1;
    if (i1 < 0) i1 = i0;
    if (i0 < 0) { liveCloseGaps(); editor.style.display = 'none'; return; }
    if (i1 < i0) { const t = i0; i0 = i1; i1 = t; }

    // Heights come from #selMirror, the same oracle column selection measures
    // against, so soft wrap and tabs are answered by the layout engine that
    // draws the real text rather than by arithmetic. syncMirror() offsets the
    // mirror by the editor's own scroll, and every number below is a difference
    // between two of its rects, so that offset cancels out.
    syncMirror();
    const node = selMirror.firstChild;
    const mirrorTop = selMirror.getBoundingClientRect().top;
    const lineH = parseFloat(getComputedStyle(selMirror).lineHeight) || 16;
    // A Range reports the glyph box, which sits inside the line box by half the
    // leading at each end. Every position here has to be a line-box edge, or
    // the revealed source is drawn a few pixels above the hole it belongs in.
    const lead = node
      ? Math.max(0, (lineH - (charRect(0, 0).height || lineH)) / 2)
      : 0;
    let textBottom = 0;
    if (node) {
      const all = document.createRange();
      all.selectNodeContents(selMirror);
      textBottom = all.getBoundingClientRect().bottom - mirrorTop + lead;
    }
    // The final line, when empty, has no glyph to measure and neither does the
    // position just past the last line; both step down from the text's bottom.
    const lastEmpty = starts[starts.length - 1] >= text.length;
    const lineTop = (n) => {
      if (!node) return n * lineH;
      if (n < starts.length && !(lastEmpty && n === starts.length - 1)) {
        return charRect(n, 0).top - mirrorTop - lead;
      }
      return textBottom + (lastEmpty && n >= starts.length ? lineH : 0);
    };

    liveCloseGaps();
    const tops = [];
    for (let i = i0; i <= i1; i++) tops.push(lineTop(groups[i].from));
    tops.push(lineTop(groups[i1].to));
    for (let i = i0; i <= i1; i++) {
      const el = groups[i].el;
      el.classList.add('live-gap');
      el.style.height = Math.max(1, tops[i - i0 + 1] - tops[i - i0]) + 'px';
      liveGaps.push(el);
    }

    const top = tops[0];
    const bottom = tops[tops.length - 1];
    const paneTop = editorPane.getBoundingClientRect().top;
    // Reading the gap's position flushes the heights just written.
    const gapTop = groups[i0].el.getBoundingClientRect().top - paneTop + editorPane.scrollTop;
    editor.style.display = '';
    editor.style.top = gapTop + 'px';
    editor.style.height = Math.max(lineH, bottom - top) + 'px';
    editor.scrollTop = top;
  }

  function liveSync() {
    if (!liveOn()) return;
    const d = activeDoc();
    if (!d) return;
    if (liveDocId !== d.id) {
      liveLayer.textContent = '';
      liveShown = [];
      liveGaps = [];
      liveDocId = d.id;
    }
    livePatch(liveBuild(d));
    liveLines = countLines(d.content);
    liveLayout();
  }

  const countLines = (text) => {
    let n = 1;
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') n += 1;
    return n;
  };

  // Typing inside a block changes only that block, and that block is the gap —
  // hidden behind the editor, so nobody can see it go stale. Re-laying out the
  // hole is cheap and has to happen now (the text wraps as you type); rendering
  // the column again is not, and can wait for a pause. Adding or removing a
  // line moves every block below, so that case rebuilds at once.
  function liveSchedule() {
    if (!liveOn() || liveFrame) return;
    liveFrame = requestAnimationFrame(() => {
      liveFrame = 0;
      if (!liveOn()) return;
      const d = activeDoc();
      if (!d || !editor) return;
      if (d.id !== liveDocId || countLines(editor.value) !== liveLines) {
        clearTimeout(liveTimer);
        liveSync();
        return;
      }
      liveLayout();
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => { if (liveOn()) liveSync(); }, 150);
    });
  }

  // ---- Clicking rendered content ----

  function caretFromPoint(x, y) {
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    return null;
  }

  // Where in a block's source a click on its rendered form landed. Rendered
  // text is very nearly the source with the markup taken out, so walking the
  // two together and skipping the characters that did not survive rendering
  // arrives at the right offset. Emoji, footnote markers and {.attrs} break
  // that assumption; when too little of the prefix matches, say so rather than
  // land the caret somewhere arbitrary — the caller drops to the block start,
  // which is off by a line or two instead of off by a paragraph.
  function liveAlign(el, x, y, src) {
    const pos = caretFromPoint(x, y);
    if (!pos) return null;
    return liveAlignNode(el, pos.node, pos.offset, src);
  }

  function liveAlignNode(el, target, offset, src) {
    if (!target || !el.contains(target)) return null;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let prefix = '';
    let node = null;
    while ((node = walk.nextNode())) {
      if (node === target) { prefix += node.data.slice(0, offset); break; }
      prefix += node.data;
    }
    if (!node) return null;
    let at = 0;
    let hit = 0;
    for (let i = 0; i < prefix.length; i++) {
      let j = at;
      while (j < src.length && src[j] !== prefix[i]) j += 1;
      if (j >= src.length) break;
      at = j + 1;
      hit += 1;
    }
    return hit >= prefix.length * 0.8 ? at : null;
  }

  // Source offsets of a group's first and last line.
  function liveSpan(g, text, starts) {
    const from = starts[Math.min(g.from, starts.length - 1)];
    const to = g.to < starts.length ? starts[g.to] : text.length;
    return { from, to };
  }

  function liveGroupOf(el) {
    const block = el && el.closest ? el.closest('.live-block') : null;
    return block ? liveShown.find((g) => g.el === block) || null : null;
  }

  // A DOM selection endpoint, as a source offset.
  function liveOffsetOfNode(node, offset) {
    const g = liveGroupOf(node.nodeType === 1 ? node : node.parentNode);
    if (!g || g.from === null || !editor) return null;
    const text = editor.value;
    const span = liveSpan(g, text, lineStarts(text));
    const at = liveAlignNode(g.el, node, offset, text.slice(span.from, span.to));
    return span.from + (at === null ? 0 : at);
  }

  // Dragging across rendered text selects it on screen, but the browser's
  // selection is in HTML the editor knows nothing about: without this the
  // highlight would be real while editor.selectionStart === selectionEnd, and
  // Ctrl+B would silently do nothing. Convert it into the editor's own
  // selection, which opens every block it touches as source.
  function liveSelectFromDom(sel) {
    if (!editor) return;
    const a = liveOffsetOfNode(sel.anchorNode, sel.anchorOffset);
    const b = liveOffsetOfNode(sel.focusNode, sel.focusOffset);
    if (a === null || b === null || a === b) return;
    sel.removeAllRanges();
    editor.setSelectionRange(Math.min(a, b), Math.max(a, b));
    liveSync();
    editor.focus();
  }

  function livePlaceCaret(e) {
    const g = liveGroupOf(e.target);
    if (!g || g.from === null || !editor) return;
    const text = editor.value;
    const span = liveSpan(g, text, lineStarts(text));
    const off = liveAlign(g.el, e.clientX, e.clientY, text.slice(span.from, span.to));
    const at = span.from + (off === null ? 0 : off);
    editor.setSelectionRange(at, at);
    liveSync();          // put the peephole over this block before focusing it
    editor.focus();
  }

  // Ticking a box off is the one edit worth making without leaving the rendered
  // view, so the caret stays where it was rather than following the change.
  function liveToggleTask(box) {
    const g = liveGroupOf(box);
    if (!g || g.from === null || !editor) return;
    const boxes = Array.from(g.el.querySelectorAll('input.task-list-item-checkbox'));
    const nth = boxes.indexOf(box);
    const text = editor.value;
    const starts = lineStarts(text);
    const selStart = editor.selectionStart;
    const selEnd = editor.selectionEnd;
    let seen = -1;
    for (let line = g.from; line < g.to && line < starts.length; line++) {
      const s = starts[line];
      const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/.exec(
        text.slice(s, lineEndAt(text, starts, line))
      );
      if (!m) continue;
      seen += 1;
      if (seen !== nth) continue;
      const at = s + m[1].length;
      replaceRange(at, at + 1, m[2] === ' ' ? 'x' : ' ', selStart, selEnd);
      return;
    }
  }

  liveLayer.addEventListener('click', (e) => {
    if (!liveOn()) return;
    const box = e.target.closest('input.task-list-item-checkbox');
    if (box) {
      e.preventDefault();   // the source is the truth; the box redraws from it
      liveToggleTask(box);
      return;
    }
    // Obsidian's rule: a plain click is for editing the link text, Ctrl+click
    // follows it. Otherwise a link would be the one thing you cannot edit.
    const link = e.target.closest('a[href]');
    if (link) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { handleRenderedClick(e, liveLayer); return; }
    }
    const sel = window.getSelection();
    // A drag rather than a click: carry the selection over to the editor.
    if (sel && !sel.isCollapsed) { liveSelectFromDom(sel); return; }
    livePlaceCaret(e);
  });

  // Right-clicking rendered text puts the caret there first, so the formatting
  // menu acts on what was clicked rather than on wherever the caret last was.
  liveLayer.addEventListener('contextmenu', (e) => {
    if (!liveOn() || !editor) return;
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) livePlaceCaret(e);
    showMenu(editorMenuItems(), e.clientX, e.clientY, editor);
  });

  document.addEventListener('selectionchange', () => {
    if (!liveOn() || !editor || document.activeElement !== editor) return;
    liveSchedule();
  });

  // ---------------- File operations ----------------

  async function openPath(path, options) {
    const existing = findByPath(path);
    if (existing) {           // already open: just go there, like a browser
      activate(existing.id, options && options.focusEditor);
      return true;
    }
    try {
      // The backend answers `{ text, lossy }` rather than a string, because a
      // caller handed only the text cannot tell a faithful read from one where
      // every undecodable byte became U+FFFD — and the caller is what decides
      // whether to offer a save, which is the act that makes the loss permanent.
      const file = await tauri.invoke('read_text_file', { path });
      addDoc(path, file.text, { ...(options || {}), readOnly: file.lossy ? LOSSY_READ : null });
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
    // A blank document has nothing to read, so read view gives way — but split
    // and live are editing views, and a new tab should not pull you out of one.
    if (!editingVisible()) setView('edit');
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
    // A read-only document may still be written — to a DIFFERENT path. That is
    // the whole route out: Save As writes the text this app can represent to a
    // new file and leaves the original's bytes where they are. Refusing the act
    // outright would leave the user with no way to keep their work.
    if (d.readOnly && path === d.path) {
      showToast(d.readOnly, true);
      return false;
    }
    const other = docs.find((x) => x !== d && x.path === path);
    if (other) {
      // Two tabs bound to one file would let the stale one silently overwrite
      // whatever was just written.
      showToast(`${baseName(path)} is already open in another tab`, true);
      return false;
    }
    // Snapshot now: keystrokes typed while the write is in flight must not
    // be marked as saved.
    const contents = editor.value;
    try {
      await tauri.invoke('write_text_file', { path, contents });
      const pathChanged = d.path !== path;
      d.path = path;
      // Save As is the way out, so it has to actually let go. The document is
      // now bound to a file this app wrote and can reproduce exactly; leaving
      // it read-only would hand the user a copy they still cannot edit, which
      // is a remedy that does not work — worse than none, because it is
      // offered.
      if (d.readOnly) {
        d.readOnly = null;
        d.el.readOnly = false;
        renderReadOnlyBanner();
      }
      // Only savedContent takes the snapshot. Assigning it to d.content too
      // would roll the document back over anything typed during the write.
      d.savedContent = contents;
      if (pathChanged) {
        d.html = null;   // relative image bases moved with the file
        if (document.body.dataset.view !== 'edit') renderPreview(false);
      }
      renderTabs(false);
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
    if (show) {
      loadHelp();
      // Without moving focus the overlay is only visually modal: typing would
      // still edit the document behind it, and PageDown would move the caret
      // instead of scrolling the help text.
      helpPanel.focus();
    } else {
      restoreFocus();
    }
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

  previewPane.addEventListener('scroll', () => { if (editor) syncScroll(previewPane, editor); });

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
  on('btn-view-live', () => setView('live'));
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

  function attachEditorListeners(ta) {
    ta.addEventListener('input', () => {
      const d = activeDoc();
      if (d) d.content = ta.value;
      scheduleRender();
      updateTitle();
      // Redrawing the strip on every keystroke would rebuild every tab and
      // reset its scroll; only the dirty dot can actually change here.
      if (d && d.dirtyShown !== docDirty(d)) renderTabs(false);
    });

    ta.addEventListener('keydown', (e) => {
      // Ctrl+Tab is tab cycling, handled on window. Without this guard the
      // editor would swallow it first and indent the line instead.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') handleEnter(e);
      else if (e.key === 'Tab') handleTab(e);
    });

    ['keyup', 'click', 'focus'].forEach((ev) =>
      ta.addEventListener(ev, updateHeadingSelect)
    );

    // Live view's reveal follows the caret. selectionchange alone is not enough
    // to drive it: the browser throttles that event and coalesces a run of
    // arrow keys into one, which would leave the reveal several lines behind.
    // These fire per keystroke; liveSchedule() coalesces them into one layout.
    ['keydown', 'keyup', 'pointerup', 'focus'].forEach((ev) =>
      ta.addEventListener(ev, () => liveSchedule())
    );

    ta.addEventListener('scroll', () => {
      if (ta !== editor) return;
      syncScroll(ta, previewPane);
      if (block) renderBlock();
    });

    // Alt+drag starts a column selection; a plain click ends one.
    ta.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.altKey) {
        e.preventDefault();   // otherwise the textarea starts its own selection
        // A rectangle across rendered blocks has no meaning in source terms,
        // and the peephole only exposes one block's worth of text to drag over.
        if (liveOn()) { showToast('Column selection needs Edit view (Ctrl+1)'); return; }
        beginBlockDrag(e);
      } else {
        clearBlock();
      }
    });

    // With a column selection up, typing and deleting apply to every line in
    // it, so the native single-range edit has to be replaced wholesale.
    ta.addEventListener('beforeinput', (e) => {
      if (!blockActive() || applyingBlock) return;
      switch (e.inputType) {
        case 'insertText':
          if (typeof e.data !== 'string') return;
          e.preventDefault();
          typeIntoBlock(e.data);
          return;
        case 'deleteContentBackward':
          e.preventDefault();
          deleteBlock(true);
          return;
        case 'deleteContentForward':
          e.preventDefault();
          deleteBlock(false);
          return;
        case 'insertFromPaste':
          return;             // handled by the paste listener
        default:
          // Enter, undo, redo and anything else: drop the block and behave
          // normally rather than guessing at a rectangular meaning for it.
          clearBlock();
      }
    });

    ta.addEventListener('copy', (e) => {
      if (!blockActive() || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', blockText());
    });

    ta.addEventListener('cut', (e) => {
      if (!blockActive() || !e.clipboardData) return;
      e.preventDefault();
      if (!blockWide()) return;   // nothing selected to cut
      e.clipboardData.setData('text/plain', blockText());
      deleteBlock(false);
    });

    ta.addEventListener('paste', (e) => {
      if (!blockActive() || !e.clipboardData) return;
      const text = e.clipboardData.getData('text/plain');
      if (text == null) return;
      e.preventDefault();
      const lines = text.split(/\r?\n/);
      const ranges = blockRanges();
      // A block-shaped clipboard goes back line for line; anything else is
      // repeated on every line, which is what makes "prefix these ten rows" work.
      if (lines.length === ranges.length && lines.length > 1) {
        replaceBlock(lines);
        clearBlock();
      } else {
        typeIntoBlock(text);
      }
    });

    ta.addEventListener('contextmenu', (e) => {
      e.preventDefault();   // replace the webview's menu with the app's own
      showMenu(editorMenuItems(), e.clientX, e.clientY, ta);
    });

    ta.addEventListener('keydown', (e) => {
      if (!blockActive()) return;
      if (e.key === 'Escape') { e.preventDefault(); clearBlock(); return; }
      // Moving the caret normally means the user is done with the rectangle.
      if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' ||
          e.key === 'PageUp' || e.key === 'PageDown') clearBlock();
    });
  }

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
    // A modal dialog that still lets shortcuts reach the document behind it
    // isn't modal. Scrolling keys fall through to the focused help panel.
    if (!helpOverlay.hidden) return;

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
        // e.repeat: holding Ctrl+W must not queue a close per key repeat.
        case 'w': e.preventDefault(); if (!e.repeat && activeId !== null) closeDoc(activeId); return;
      }
      switch (e.code) {
        case 'Digit1': e.preventDefault(); setView('edit'); return;
        case 'Digit2': e.preventDefault(); setView('split'); return;
        case 'Digit3': e.preventDefault(); setView('read'); return;
        case 'Digit4': e.preventDefault(); setView('live'); return;
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

  // The print stylesheet un-hides the preview, so printing from Edit view would
  // otherwise put whatever was rendered last on paper — with tabs, potentially
  // a different document than the one on screen.
  window.addEventListener('beforeprint', () => { if (previewStale()) renderPreview(false); });

  // A second launch (double-clicking another .md in Explorer) hands its path
  // to this window rather than starting a second copy of the app.
  async function openLaunched(path) {
    if (!path) return;
    const opened = await openPath(path, { focusEditor: false });
    // Arriving from Explorer means reading, the same as a first launch.
    if (opened) setView('read');
  }

  if (tauri.listen) {
    tauri.listen('open-file', (event) => {
      const path = typeof event.payload === 'string' ? event.payload : null;
      if (path) openLaunched(path);
    });
  }

  // ---------------- Startup ----------------

  async function init() {
    applyTheme();

    // A window created by tearing off a tab has its document waiting on the
    // Rust side under this window's label; every other window gets null back.
    let handoff = null;
    if (tauri.available) {
      try { handoff = await tauri.invoke('take_handoff'); } catch (e) {}
    }

    // Seed an empty doc so there is always exactly one active document.
    docs = [makeDoc(null, '')];
    showDoc(docs[0]);

    // Process arguments belong to the original window only: a torn-off window
    // re-reading them would open the launch file a second time.
    const isMain = !tauri.available || tauri.windowLabel() === 'main';

    if (handoff) {
      const d = addDoc(handoff.path, handoff.content,
                       { focusEditor: false, readOnly: handoff.read_only || null });
      // Carry the dirty state across: the text was never saved, and the new
      // window must know that as well as the old one did.
      d.savedContent = handoff.saved;
      d.el.value = handoff.content;
      d.content = handoff.content;
      setView(docDirty(d) ? 'edit' : 'read');
    } else {
      let launchPath = null;
      if (isMain) {
        try { launchPath = await tauri.invoke('launch_file_path'); } catch (e) {}
      }
      const opened = launchPath ? await openPath(launchPath) : false;
      // Opened with a file (double-click in Explorer): reading is the intent.
      // Blank start — or an unreadable launch file — begins in the editor.
      setView(opened ? 'read' : 'edit');

      // Anything a second launch handed over before this script was listening.
      if (isMain && tauri.available) {
        try {
          const pending = await tauri.invoke('take_pending_files');
          for (const p of pending || []) await openLaunched(p);
        } catch (e) { /* older build without the command */ }
      }
    }

    renderTabs(true);
    updateTitle();
    if (window.__showAppWindow) window.__showAppWindow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
