'use strict';
/* ===========================================================================
   commands.js — one registry behind three surfaces.

   Obsidian's command palette and Notion's slash menu are the two most-praised
   interactions in either app, and they're the same idea: name a thing, get it.
   So every action lives in one list, and the palette (⌘⇧P), the canvas slash
   menu (/), and the in-text slash menu all read from it.
   =========================================================================== */
App.commands = (() => {
  const U = App.util;
  const store = App.store;

  const list = [];
  const register = (cmd) => { list.push(cmd); return cmd; };
  const all = () => list;

  /** Subsequence fuzzy match — "nsn" hits "New Sticky Note". Returns a score
   *  or -1; earlier and tighter matches rank higher. */
  function fuzzy(needle, hay) {
    const n = needle.toLowerCase().trim();
    const h = hay.toLowerCase();
    if (!n) return 0;
    if (h.includes(n)) return 1000 - h.indexOf(n);
    let i = 0, score = 0, last = -1;
    for (const ch of n) {
      const idx = h.indexOf(ch, i);
      if (idx < 0) return -1;
      score += (last >= 0 && idx === last + 1) ? 6 : 1;
      last = idx; i = idx + 1;
    }
    return score;
  }

  function search(q, pool = list) {
    if (!q || !q.trim()) return pool.filter(c => !c.hidden);
    return pool
      .filter(c => !c.hidden)
      .map(c => ({ c, s: Math.max(fuzzy(q, c.title), fuzzy(q, c.group || '')) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map(x => x.c);
  }

  // ── where new blocks land ───────────────────────────────────────────────
  /** Centre of the viewport in world coords — where "insert" things go. */
  function dropPoint() {
    const r = App.canvas.viewportEl.getBoundingClientRect();
    return App.canvas.toWorld({ x: r.width / 2, y: r.height / 2 });
  }

  /** Place a new node without making the user think about layout.
   *  If something is selected we tuck the new block just below it, otherwise
   *  we use the viewport centre and nudge until we're not covering anything. */
  function placeFor(w, h) {
    const sel = store.selectedNodes();
    let p;
    if (sel.length) {
      const b = U.bbox(sel);
      p = { x: b.x, y: b.y + b.h + 28 };
    } else {
      const c = dropPoint();
      p = { x: c.x - w / 2, y: c.y - h / 2 };
    }
    const nodes = store.doc().nodes;
    let guard = 0;
    while (guard++ < 60) {
      const box = { x: p.x, y: p.y, w, h };
      const clash = nodes.some(n => n.w > 0 && n.type !== 'group' && U.rectsOverlap(box, U.nodeRect(n)));
      if (!clash) break;
      p.y += 30; p.x += 12;
    }
    return { x: Math.round(p.x / 8) * 8, y: Math.round(p.y / 8) * 8 };
  }

  function insert(type, extra = {}) {
    const d = App.nodes.DEFAULTS[type] || { w: 220, h: 140 };
    const p = placeFor(d.w, d.h);
    const n = App.nodes.create(type, p.x, p.y, extra);
    store.addNode(n);
    App.canvas.ensureVisible(n);
    requestAnimationFrame(() => App.canvas.focusNode(n.id));
    return n;
  }

  // ── the registry ────────────────────────────────────────────────────────
  function build() {
    const ins = (title, type, icon, extra) => register({
      id: 'insert.' + type + (extra && extra.kind ? '.' + extra.kind : ''),
      title, icon, group: 'Insert', insert: true,
      run: () => insert(type, extra || {}),
    });

    ins('Note',            'note',   '📄');
    ins('Sticky note',     'sticky', '🟨');
    ins('Checklist',       'todo',   '☑');
    ins('Table',           'table',  '▦');
    ins('Rectangle',       'shape',  '▭', { kind: 'rect' });
    ins('Ellipse',         'shape',  '◯', { kind: 'ellipse' });
    ins('Diamond',         'shape',  '◆', { kind: 'diamond' });
    ins('Triangle',        'shape',  '△', { kind: 'triangle' });
    ins('Line',            'shape',  '╱', { kind: 'line' });
    ins('Section / frame', 'group',  '⬚');

    register({
      id: 'insert.embed', title: 'Embed a page', icon: '🔗', group: 'Insert', insert: true,
      run: () => App.embed.pickPage(),
    });
    register({
      id: 'insert.dim', title: 'Dimension (measure two points)', icon: '📐',
      group: 'Insert', insert: true, keys: 'M',
      run: () => { store.setTool('dim'); App.app.toast('Drag between two points — it snaps to corners'); },
    });

    register({ id: 'cad.drafting', title: 'Drafting look (white paper, no colour)', icon: '📄', group: 'Drafting',
      run: () => store.setTheme('drafting') });
    register({ id: 'cad.studio', title: 'Studio look (dark canvas)', icon: '🎨', group: 'Drafting',
      run: () => store.setTheme('studio') });
    register({ id: 'group.contents', title: 'Select the contents of this section', icon: '⧉',
      group: 'Page', run: () => {
        const kids = store.selectedNodes().filter(n => n.type === 'group')
          .flatMap(g => App.groups.childrenOf(g));
        if (kids.length) store.select(kids.map(n => n.id));
      } });
    register({ id: 'sheet.open', title: 'Background colour, grid, line thickness, text size…',
      icon: '🎚', group: 'Drafting', run: () => document.getElementById('btn-sheet').click() });
    register({
      id: 'insert.title', title: 'Title block', icon: '▤', group: 'Insert', insert: true,
      run: () => insert('title', {
        date: new Date().toISOString().slice(0, 10),
      }),
    });
    register({ id: 'cad.sheet', title: 'Make this section a paper sheet…', icon: '🗎', group: 'Drafting',
      run: () => {
        const g = store.selectedNodes().find(n => n.type === 'group');
        if (!g) return App.app.toast('Select a section first');
        const names = App.cad.PAPER_NAMES;
        const opts = [];
        for (const n of names) { opts.push(`${n} landscape`); opts.push(`${n} portrait`); }
        App.app.choose('Sheet size', opts, (pick) => {
          const [name, orient] = pick.split(' ');
          store.beginChange('sheet');
          App.cad.applySheet(g, name, orient);
          const el = document.querySelector(`[data-id="${g.id}"]`);
          if (el) el._key = null;
          store.commit({ full: true });
          App.app.toast(`${name} ${orient} — ${g.w}×${g.h} canvas px`);
        });
      } });
    register({ id: 'cad.scale', title: 'Document units and scale…', icon: '⚖', group: 'Drafting',
      run: () => document.getElementById('btn-units').click() });
    register({ id: 'cad.relabel', title: 'Override the selected dimension text…', icon: '🏷', group: 'Drafting',
      run: () => {
        const n = store.selectedNodes().find(x => x.type === 'dim');
        if (!n) return App.app.toast('Select a dimension first');
        App.app.prompt('Dimension label (blank = measured value)', n.label || '', (v) => {
          store.beginChange('dim label');
          n.label = v.trim();
          const el = document.querySelector(`[data-id="${n.id}"]`);
          if (el) el._key = null;
          store.commit({ full: true });
        });
      } });

    register({ id: 'pdf.section', title: 'Export selected section as PDF', icon: '🖨', group: 'File', keys: '⌘P',
      run: () => App.exporter.sectionPdf() });
    register({ id: 'pdf.all', title: 'Export every section as PDF (one page each)', icon: '🖨', group: 'File',
      run: () => App.exporter.allSectionsPdf() });
    register({ id: 'pdf.page', title: 'Export whole page as PDF', icon: '🖨', group: 'File', keys: '⌥⌘P',
      run: () => App.exporter.pagePdf() });
    register({ id: 'pdf.bg', title: 'Toggle PDF background (white / dark)', icon: '◐', group: 'File',
      run: () => App.exporter.toggleLight() });

    register({
      id: 'page.new', title: 'New page', icon: '＋', group: 'Page', keys: '⌘N',
      run: () => store.newPage(),
    });
    register({
      id: 'page.daily', title: "Open today's daily note", icon: '📅', group: 'Page', keys: '⌘⇧D',
      run: () => App.daily.open(),
    });
    register({
      id: 'folder.new', title: 'New folder', icon: App.icons.folder, group: 'Page',
      run: () => App.app.prompt('New folder name', '', (v) => { if (v.trim()) store.newFolder(v.trim()); }),
    });
    register({
      id: 'page.move', title: 'Move this page to a folder…', icon: '⇢', group: 'Page',
      run: () => {
        const d = store.doc();
        if (!d) return;
        const opts = ['(vault root)', ...store.state.folders];
        App.app.choose('Move to folder', opts, (pick, i, made) => {
          const target = made || (i === 0 ? '' : opts[i]);
          store.movePage(d.id, target);
          App.app.toast(target ? `Moved to ${target}` : 'Moved to vault root');
        }, { allowNew: 'New folder…' });
      },
    });
    register({
      id: 'page.rename', title: 'Rename this page', icon: '✎', group: 'Page',
      run: () => { const t = document.getElementById('page-title'); t.focus(); t.select(); },
    });
    register({
      id: 'page.promote', title: 'Turn selected note into its own page', icon: '⇗', group: 'Page',
      run: () => App.app.promoteNoteToPage(store.selectedNodes()[0]),
    });
    register({
      id: 'page.delete', title: 'Delete this page', icon: '🗑', group: 'Page',
      run: () => {
        const d = store.doc();
        if (confirm(`Delete "${d.name}"? The file is removed from your vault.`)) store.deletePage(d.id);
      },
    });

    register({ id: 'view.graph', title: 'Open graph view', icon: '🕸', group: 'View', keys: '⌘G',
      run: () => App.graph.toggle() });
    register({ id: 'view.outline', title: 'Toggle outline panel', icon: '☰', group: 'View', keys: '⌘⇧O',
      run: () => App.panels.toggleOutline() });
    register({ id: 'view.minimap', title: 'Toggle minimap', icon: '🗺', group: 'View',
      run: () => App.panels.toggleMinimap() });
    register({ id: 'view.switcher', title: 'Quick switcher (jump to a page)', icon: '⌕', group: 'View', keys: '⌘K',
      run: () => App.commands.open() });
    register({ id: 'view.outlines', title: 'Toggle selection outlines', icon: '▢', group: 'View',
      run: () => {
        const app = document.getElementById('app');
        const on = app.classList.toggle('show-selection');
        localStorage.setItem('showSelection', on ? 'yes' : 'no');
        App.app.toast(`Selection outlines ${on ? 'on' : 'off'}`);
      } });
    register({ id: 'view.sidebar', title: 'Toggle sidebar', icon: '◧', group: 'View', keys: '⌘\\',
      run: () => App.app.toggleSidebar() });
    register({ id: 'view.fit', title: 'Zoom to fit', icon: '⤢', group: 'View', keys: '⇧1',
      run: () => App.canvas.zoomToFit() });
    register({ id: 'view.selection', title: 'Zoom to selection', icon: '⌖', group: 'View', keys: '⇧2',
      run: () => App.canvas.zoomToSelection() });
    register({ id: 'view.100', title: 'Zoom to 100%', icon: '％', group: 'View', keys: '⌘0',
      run: () => App.canvas.zoomTo(1) });

    register({ id: 'sel.similar', title: 'Select all of the same type', icon: '⧉', group: 'Selection', keys: '⌘⇧A',
      run: () => {
        const sel = store.selectedNodes();
        if (!sel.length) return;
        const kinds = new Set(sel.map(n => n.type));
        store.select(store.doc().nodes.filter(n => kinds.has(n.type)).map(n => n.id));
      } });
    register({ id: 'sel.all', title: 'Select everything', icon: '▣', group: 'Selection', keys: '⌘A',
      run: () => store.select(store.doc().nodes.map(n => n.id)) });
    register({ id: 'sel.group', title: 'Wrap selection in a section', icon: '⬚', group: 'Selection', keys: '⇧⌘G',
      run: () => App.groups.wrapSelection() });

    const align = (how) => register({
      id: 'align.' + how, title: 'Align ' + how, icon: '⊞', group: 'Arrange',
      run: () => App.arrange.align(how),
    });
    ['left', 'centre', 'right', 'top', 'middle', 'bottom'].forEach(align);
    register({ id: 'align.distH', title: 'Distribute horizontally', icon: '⇹', group: 'Arrange',
      run: () => App.arrange.distribute('h') });
    register({ id: 'align.distV', title: 'Distribute vertically', icon: '⇳', group: 'Arrange',
      run: () => App.arrange.distribute('v') });
    register({ id: 'align.tidy', title: 'Tidy selection into a grid', icon: '⊟', group: 'Arrange',
      run: () => App.arrange.tidy() });

    register({ id: 'edit.dup', title: 'Duplicate', icon: '⧉', group: 'Edit', keys: '⌘D',
      run: () => store.duplicateSelected() });
    register({ id: 'edit.del', title: 'Delete selection', icon: '⌫', group: 'Edit',
      run: () => store.deleteSelected() });
    register({ id: 'edit.undo', title: 'Undo', icon: '↶', group: 'Edit', keys: '⌘Z',
      run: () => store.undo() });
    register({ id: 'edit.redo', title: 'Redo', icon: '↷', group: 'Edit', keys: '⇧⌘Z',
      run: () => store.redo() });

    register({ id: 'file.exportCanvas', title: 'Export as .canvas (JSON Canvas, opens in Obsidian)',
      icon: '⤓', group: 'File', run: () => App.jsoncanvas.exportCurrent() });
    register({ id: 'file.importCanvas', title: 'Import a .canvas file', icon: '⤒', group: 'File',
      run: () => App.jsoncanvas.importFile() });
    register({ id: 'file.exportMd', title: 'Export page as Markdown', icon: '⤓', group: 'File',
      run: () => App.jsoncanvas.exportMarkdown() });
    register({ id: 'file.png', title: 'Export view as PNG', icon: '🖼', group: 'File', keys: '⌘⇧E',
      run: () => App.app.exportPng() });
    register({ id: 'file.reveal', title: 'Open vault folder', icon: '📂', group: 'File',
      run: () => window.api.revealVault() });
    register({ id: 'insert.link', title: 'Link card (web address)', icon: '🌐', group: 'Insert', insert: true,
      run: () => App.app.prompt('Link URL', 'https://', (v) => {
        const t = v.trim();
        if (!/^https?:\/\/\S+$/i.test(t)) return App.app.toast('That is not a web address');
        const d = App.nodes.DEFAULTS.link;
        const n = App.app.insertFromText(t, placeFor(d.w, d.h));
        if (n) App.canvas.ensureVisible(n);
      }) });
    register({ id: 'vault.emptyTrash', title: 'Empty trash (deleted pages)', icon: '🗑', group: 'File',
      run: async () => {
        const n = await window.api.trashCount();
        if (!n) return App.app.toast('The trash is empty');
        if (confirm(`Permanently delete ${n} page${n === 1 ? '' : 's'} in the trash?`)) {
          await window.api.emptyTrash();
          App.app.toast('Trash emptied');
        }
      } });
    register({ id: 'vault.revealTrash', title: 'Open trash folder (deleted pages)', icon: '📂', group: 'File',
      run: () => window.api.revealTrash() });
    register({ id: 'vault.cleanAssets', title: 'Delete unused images from the vault', icon: '🧹', group: 'File',
      run: async () => {
        const removed = await window.api.cleanAssets(store.referencedAssets());
        App.app.toast(removed ? `Removed ${removed} unused image${removed === 1 ? '' : 's'}` : 'No unused images');
      } });
  }

  // ── palette UI ──────────────────────────────────────────────────────────
  let box, input, results, items = [], idx = 0, mode = 'all', pickCb = null;

  function open(opts = {}) {
    mode = opts.mode || 'all';
    pickCb = opts.onPick || null;
    box.classList.remove('hidden');
    input.value = opts.query || '';
    input.placeholder = opts.placeholder || (
      mode === 'insert' ? 'Insert a block…' :
      mode === 'page'   ? 'Choose a page…' :
      'Type a command, or a page name to jump to it…');
    idx = 0;
    refresh();
    setTimeout(() => input.focus(), 10);
  }

  function close() { box.classList.add('hidden'); }
  const isOpen = () => !box.classList.contains('hidden');

  function refresh() {
    const q = input.value.replace(/^\//, '');
    const pool = mode === 'insert' ? list.filter(c => c.insert) : list;
    items = mode === 'page' ? [] : search(q, pool).map(c => ({ kind: 'cmd', cmd: c }));

    if (mode === 'page') {
      items = store.state.pages
        .map(p => ({ p, s: fuzzy(q, p.name) }))
        .filter(x => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map(x => ({ kind: 'page', page: x.p }));
      if (q.trim() && !store.pageExists(q.trim())) items.push({ kind: 'new', name: q.trim() });
    }

    if (mode === 'all') {
      const pages = store.state.pages
        .map(p => ({ p, s: fuzzy(q, p.name) }))
        .filter(x => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 8)
        .map(x => ({ kind: 'page', page: x.p }));
      items = q ? [...pages, ...items] : [...items, ...pages];
      if (q.trim() && !store.pageExists(q.trim())) {
        items.push({ kind: 'new', name: q.trim() });
      }
    }
    items = items.slice(0, 40);
    idx = U.clamp(idx, 0, Math.max(0, items.length - 1));

    results.innerHTML = items.map((it, i) => {
      const on = i === idx ? ' on' : '';
      if (it.kind === 'cmd') {
        return `<div class="sw-item${on}" data-i="${i}">
          <span><span class="sw-ico">${it.cmd.icon || '•'}</span>${U.esc(it.cmd.title)}</span>
          <span class="sw-hint">${U.esc(it.cmd.keys || it.cmd.group || '')}</span></div>`;
      }
      if (it.kind === 'page') {
        return `<div class="sw-item${on}" data-i="${i}">
          <span><span class="sw-ico">📄</span>${U.esc(it.page.name)}</span>
          <span class="sw-hint">page · ${it.page.nodeCount} items</span></div>`;
      }
      return `<div class="sw-item${on}" data-i="${i}">
        <span><span class="sw-ico">＋</span>Create page “${U.esc(it.name)}”</span>
        <span class="sw-hint">new</span></div>`;
    }).join('') || '<div class="sw-item" style="opacity:.5">Nothing matches</div>';

    results.querySelectorAll('[data-i]').forEach(d => {
      d.addEventListener('mouseenter', () => { idx = +d.dataset.i; paintSel(); });
      d.addEventListener('click', () => run(+d.dataset.i));
    });
    const on = results.querySelector('.sw-item.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  function paintSel() {
    results.querySelectorAll('.sw-item').forEach((el, i) => el.classList.toggle('on', i === idx));
  }

  async function run(i) {
    const it = items[i];
    const cb = pickCb;
    close();
    pickCb = null;
    if (!it) return;

    if (cb) {                       // page-picker mode: hand the page back
      if (it.kind === 'page') return cb(it.page);
      if (it.kind === 'new') {
        const d = await store.newPage(it.name, { open: false });
        return cb({ id: d.id, name: d.name });
      }
      return;
    }
    if (it.kind === 'cmd') return it.cmd.run();
    if (it.kind === 'page') return store.openPage(it.page.id);
    if (it.kind === 'new') return store.newPage(it.name);
  }

  function mount() {
    box = document.getElementById('palette');
    input = document.getElementById('palette-input');
    results = document.getElementById('palette-results');
    build();

    input.addEventListener('input', () => { idx = 0; refresh(); });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, items.length - 1); paintSel(); scrollTo(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); paintSel(); scrollTo(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(idx); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    box.addEventListener('pointerdown', (e) => { if (e.target === box) close(); });
  }

  function scrollTo() {
    const on = results.querySelector('.sw-item.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  return { register, all, search, fuzzy, mount, open, close, isOpen, insert, placeFor, dropPoint };
})();
