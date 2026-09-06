'use strict';
/* ===========================================================================
   store.js — the document model.

   One page = one doc = one JSON file in the vault:
     { id, name, nodes[], edges[], comments[], camera }

   Mutations go through commit() so undo/redo and autosave stay honest.
   =========================================================================== */
App.store = (() => {
  const U = App.util;

  const state = {
    vaultPath: '',
    pages: [],            // vault index: {id,name,folder,updated,nodeCount}
    folders: [],          // every folder in the vault, including empty ones
    collapsed: new Set(JSON.parse(localStorage.getItem('collapsedFolders') || '[]')),
    doc: null,            // the open page
    docIndex: [],         // every doc, cached for search/backlinks
    selection: new Set(), // node ids
    selectedEdge: null,
    tool: 'select',
    pen: { color: '#e8e8ee', size: 3 },
    undo: [],
    redo: [],
    dirty: false,
    listeners: {},
  };

  // ── events ──────────────────────────────────────────────────────────────
  function on(evt, fn) { (state.listeners[evt] ||= []).push(fn); }
  function emit(evt, payload) { (state.listeners[evt] || []).forEach(f => f(payload)); }

  // ── doc factory ─────────────────────────────────────────────────────────
  function blankDoc(name = 'Untitled canvas') {
    return {
      id: U.uid('page'),
      name,
      created: Date.now(),
      updated: Date.now(),
      camera: { x: 0, y: 0, z: 1 },
      theme: 'studio',            // 'studio' (canvas) or 'drafting' (paper)
      nodes: [],
      edges: [],
      comments: [],
    };
  }

  const doc = () => state.doc;
  const nodeById = (id) => state.doc?.nodes.find(n => n.id === id);
  const selectedNodes = () => state.doc ? state.doc.nodes.filter(n => state.selection.has(n.id)) : [];
  const topZ = () => (state.doc?.nodes.reduce((m, n) => Math.max(m, n.z || 0), 0) || 0);

  // ── history ─────────────────────────────────────────────────────────────
  let pendingLabel = null;
  function snapshot() {
    return JSON.stringify({ nodes: state.doc.nodes, edges: state.doc.edges, comments: state.doc.comments });
  }
  function restore(snap) {
    const s = JSON.parse(snap);
    state.doc.nodes = s.nodes; state.doc.edges = s.edges; state.doc.comments = s.comments;
    // drop selections pointing at nodes that no longer exist
    for (const id of [...state.selection]) if (!nodeById(id)) state.selection.delete(id);
  }

  /** Call BEFORE mutating when you want the change to be undoable. */
  function beginChange(label) {
    if (!state.doc) return;
    pendingLabel = label;
    state.undo.push(snapshot());
    if (state.undo.length > 120) state.undo.shift();
    state.redo.length = 0;
  }

  /** Call AFTER mutating: marks dirty, redraws, schedules a save. */
  function commit(opts = {}) {
    if (!state.doc) return;
    state.doc.updated = Date.now();
    state.dirty = true;
    emit('doc-changed', opts);
    scheduleSave();
  }

  /** Mark dirty + schedule a save WITHOUT a re-render (camera moves, etc). */
  function touch() { state.dirty = true; emit('dirty'); scheduleSave(); }

  function undo() {
    if (!state.undo.length) return;
    state.redo.push(snapshot());
    restore(state.undo.pop());
    commit({ full: true });
    emit('selection-changed');
  }
  function redoAction() {
    if (!state.redo.length) return;
    state.undo.push(snapshot());
    restore(state.redo.pop());
    commit({ full: true });
    emit('selection-changed');
  }

  // ── persistence ─────────────────────────────────────────────────────────
  const scheduleSave = U.debounce(async () => { await save(); }, 550);

  async function save() {
    if (!state.doc) return;
    await window.api.writePage(state.doc);
    state.dirty = false;
    emit('saved');
    await refreshIndex();
  }

  async function refreshIndex() {
    const idx = await window.api.readIndex();
    state.pages = idx.pages;
    state.docIndex = idx.docs;
    state.folders = idx.folders;
    emit('vault-changed');
  }

  // ── folders ─────────────────────────────────────────────────────────────
  async function newFolder(name) {
    const rel = await window.api.createFolder(name);
    if (rel) await refreshIndex();
    return rel;
  }

  async function renameFolder(from, to) {
    if (await window.api.renameFolder({ from, to })) {
      if (state.collapsed.delete(from)) state.collapsed.add(to);
      persistCollapsed();
      await refreshIndex();
      if (state.doc) {
        const me = state.pages.find(p => p.id === state.doc.id);
        if (me) state.doc.folder = me.folder;
      }
    }
  }

  async function deleteFolder(name) {
    await window.api.deleteFolder(name);
    await refreshIndex();
    if (state.doc) {
      const me = state.pages.find(p => p.id === state.doc.id);
      if (me) state.doc.folder = me.folder;
    }
  }

  /** Move a page into a folder ('' = vault root). The file really moves. */
  async function movePage(id, folder) {
    const isOpen = state.doc && state.doc.id === id;
    const doc = isOpen ? state.doc : await window.api.readPage(id);
    if (!doc) return;
    doc.folder = folder || '';
    await window.api.writePage(doc);
    await refreshIndex();
  }

  function toggleFolder(name) {
    state.collapsed.has(name) ? state.collapsed.delete(name) : state.collapsed.add(name);
    persistCollapsed();
    emit('vault-changed');
  }
  const persistCollapsed = () =>
    localStorage.setItem('collapsedFolders', JSON.stringify([...state.collapsed]));

  async function init() {
    const info = await window.api.vaultInfo();
    state.vaultPath = info.path;
    state.vaultFellBack = info.fellBack;
    await refreshIndex();
    if (!state.pages.length) {
      const d = seedDoc();
      state.doc = d;
      await window.api.writePage(d);
      await refreshIndex();
    }
    await openPage(state.pages[0].id);
  }

  async function openPage(id) {
    if (state.doc && state.dirty) await save();
    const d = await window.api.readPage(id);
    if (!d) return;
    d.nodes ||= []; d.edges ||= []; d.comments ||= [];
    d.camera ||= { x: 0, y: 0, z: 1 };
    d.theme ||= 'studio';
    state.doc = d;
    state.selection.clear();
    state.selectedEdge = null;
    state.undo.length = 0; state.redo.length = 0;
    emit('page-opened', d);
    emit('doc-changed', { full: true });
    emit('selection-changed');
  }

  async function newPage(name = 'Untitled canvas', opts = {}) {
    const d = blankDoc(name);
    d.folder = opts.folder != null ? opts.folder : (state.doc && state.doc.folder) || '';
    await window.api.writePage(d);
    await refreshIndex();
    if (opts.open !== false) await openPage(d.id);
    return d;
  }

  async function deletePage(id) {
    await window.api.deletePage(id);
    await refreshIndex();
    if (state.doc?.id === id) {
      if (state.pages.length) await openPage(state.pages[0].id);
      else { const d = await newPage('Untitled canvas', { open: false }); await openPage(d.id); }
    }
  }

  async function renamePage(name) {
    if (!state.doc) return;
    state.doc.name = name || 'Untitled';
    commit();
  }

  // ── wikilinks ───────────────────────────────────────────────────────────
  const norm = (s) => String(s || '').trim().toLowerCase();
  const pageExists = (name) => state.pages.some(p => norm(p.name) === norm(name));
  const pageByName = (name) => state.pages.find(p => norm(p.name) === norm(name));

  /** Text of a node, for link extraction and search. */
  function nodeText(n) {
    switch (n.type) {
      case 'note':   return `${n.title || ''}\n${n.body || ''}`;
      case 'sticky': return n.text || '';
      case 'todo':   return `${n.title || ''}\n` + (n.items || []).map(i => i.text).join('\n');
      case 'shape':  return n.text || '';
      case 'table':  return (n.cols || []).join(' ') + '\n' + (n.rows || []).map(r => r.join(' ')).join('\n');
      case 'group':  return n.label || '';
      case 'embed':  return n.pageName ? `[[${n.pageName}]]` : '';
      case 'link':   return `${n.title || ''} ${n.url || ''}`;
      default:       return '';
    }
  }

  /** A short human label for a node — used by outline, graph and search. */
  function nodeLabel(n) {
    const first = (nodeText(n) || '').split('\n').map(s => s.trim()).find(Boolean) || '';
    if (n.type === 'ink') return 'Drawing';
    if (n.type === 'image') return 'Image';
    if (n.type === 'group') return n.label || 'Section';
    return first.slice(0, 60) || `Empty ${n.type}`;
  }

  /** The vault as a list, with the page you're editing substituted in for its
   *  (possibly stale) saved copy — so backlinks, tags and the graph reflect
   *  what you just typed rather than what was last written to disk. */
  function indexDocs() {
    if (!state.doc) return state.docIndex;
    const out = state.docIndex.filter(d => d.id !== state.doc.id);
    out.push(state.doc);
    return out;
  }

  /** The freshest copy of a page: the open doc if it's that one, else the
   *  cached index copy. Embeds read through this so they stay live. */
  function docById(id) {
    if (!id) return null;
    if (state.doc && state.doc.id === id) return state.doc;
    return state.docIndex.find(d => d.id === id) || null;
  }

  /** Changes whenever an embedded page changes, so embed cards re-render. */
  function embedRevision(id) {
    const d = docById(id);
    return d ? d.updated || 0 : 0;
  }

  // ── tags ────────────────────────────────────────────────────────────────
  const TAG_RE = /(^|[\s(\[])#([a-z0-9][\w/-]{0,40})/gi;

  function tagsIn(text) {
    const out = new Set();
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(String(text || '')))) out.add(m[2].toLowerCase());
    return [...out];
  }

  function docTags(d) {
    const out = new Set();
    for (const n of (d.nodes || [])) for (const t of tagsIn(nodeText(n))) out.add(t);
    return [...out];
  }

  /** Every tag in the vault with its page count, most used first. */
  function allTags() {
    const counts = new Map();
    for (const d of indexDocs()) {
      for (const t of docTags(d)) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function pagesWithTag(tag) {
    const t = String(tag).toLowerCase();
    return indexDocs().filter(d => docTags(d).includes(t));
  }

  /** Obsidian's "unlinked mentions": the page name appears verbatim in another
   *  page's text but isn't wrapped in [[ ]]. These are the links you meant to
   *  make and didn't. */
  function unlinkedMentions(pageName) {
    const name = String(pageName || '').trim();
    if (name.length < 3) return [];
    const target = norm(name);
    const re = new RegExp(`(^|[^\\w\\[])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w\\]]|$)`, 'i');
    const out = [];
    for (const d of indexDocs()) {
      if (norm(d.name) === target) continue;
      for (const n of (d.nodes || [])) {
        const txt = nodeText(n);
        if (!txt || !re.test(txt)) continue;
        // already an explicit link? then it's a backlink, not an unlinked one
        if (App.md.links(txt).some(l => norm(l) === target)) continue;
        const i = txt.toLowerCase().indexOf(target);
        out.push({
          pageId: d.id, pageName: d.name, nodeId: n.id,
          snippet: txt.slice(Math.max(0, i - 34), i + 76).replace(/\n/g, ' '),
        });
        break;
      }
    }
    return out;
  }

  /** Pages linking INTO `pageName`, with the snippet that links them. */
  function backlinksFor(pageName) {
    const target = norm(pageName);
    const out = [];
    for (const d of indexDocs()) {
      if (norm(d.name) === target) continue;
      for (const n of (d.nodes || [])) {
        const txt = nodeText(n);
        if (App.md.links(txt).some(l => norm(l) === target)) {
          out.push({ pageId: d.id, pageName: d.name, nodeId: n.id, snippet: txt.slice(0, 110).replace(/\n/g, ' ') });
        }
      }
    }
    return out;
  }

  function searchAll(q) {
    const needle = norm(q);
    if (!needle) return [];
    const hits = [];
    for (const d of indexDocs()) {
      const inName = norm(d.name).includes(needle);
      let snippet = '';
      for (const n of (d.nodes || [])) {
        const t = nodeText(n);
        const i = norm(t).indexOf(needle);
        if (i >= 0) { snippet = t.slice(Math.max(0, i - 30), i + 70).replace(/\n/g, ' '); break; }
      }
      if (inName || snippet) hits.push({ id: d.id, name: d.name, snippet });
    }
    return hits;
  }

  // ── selection ───────────────────────────────────────────────────────────
  function select(ids, additive = false) {
    if (!additive) state.selection.clear();
    for (const id of [].concat(ids)) state.selection.add(id);
    state.selectedEdge = null;
    emit('selection-changed');
  }
  function toggleSelect(id) {
    state.selection.has(id) ? state.selection.delete(id) : state.selection.add(id);
    emit('selection-changed');
  }
  function clearSelection() {
    state.selection.clear();
    state.selectedEdge = null;
    emit('selection-changed');
  }

  function setTool(t) { state.tool = t; emit('tool-changed', t); }

  /** Switch a page between the canvas look and the drawing look. */
  function setTheme(theme) {
    if (!state.doc) return;
    beginChange('theme');
    state.doc.theme = theme;
    App.palette.use(theme);
    state.pen.color = App.palette.ink[0];
    applyTheme();
    for (const n of state.doc.nodes) {
      const el = document.querySelector(`[data-id="${n.id}"]`);
      if (el) el._key = null;
    }
    commit({ full: true });
  }

  function applyTheme() {
    const theme = (state.doc && state.doc.theme) || 'studio';
    document.getElementById('app').classList.toggle('drafting', theme === 'drafting');
    if (App.sheet) App.sheet.apply();
    App.palette.use(theme);
    if (!App.palette.ink.includes(state.pen.color)) state.pen.color = App.palette.ink[0];
    const btn = document.getElementById('btn-theme');
    if (btn) {
      btn.textContent = theme === 'drafting' ? 'Drafting' : 'Studio';
      btn.classList.toggle('on', theme === 'drafting');
    }
  }

  // ── node/edge mutation helpers ──────────────────────────────────────────
  function addNode(node, opts = {}) {
    beginChange('add');
    node.z = topZ() + 1;
    state.doc.nodes.push(node);
    commit({ full: true });
    if (opts.select !== false) select(node.id);
    return node;
  }

  function deleteSelected() {
    if (!state.selection.size && !state.selectedEdge) return;
    beginChange('delete');
    const ids = new Set(state.selection);
    state.doc.nodes = state.doc.nodes.filter(n => !ids.has(n.id));
    state.doc.edges = state.doc.edges.filter(e =>
      !(e.from && ids.has(e.from)) && !(e.to && ids.has(e.to)) && e.id !== state.selectedEdge);
    state.doc.comments = state.doc.comments.filter(c => !ids.has(c.nodeId));
    state.selection.clear();
    state.selectedEdge = null;
    commit({ full: true });
    emit('selection-changed');
  }

  function duplicateSelected() {
    const sel = selectedNodes();
    if (!sel.length) return;
    beginChange('duplicate');
    const fresh = [];
    for (const n of sel) {
      const c = structuredClone(n);
      c.id = U.uid(n.type);
      c.x += 26; c.y += 26; c.z = topZ() + 1;
      state.doc.nodes.push(c);
      fresh.push(c.id);
    }
    commit({ full: true });
    select(fresh);
  }

  function bringToFront() {
    beginChange('z');
    let z = topZ();
    for (const n of selectedNodes()) n.z = ++z;
    commit({ full: true });
  }
  function sendToBack() {
    beginChange('z');
    const min = state.doc.nodes.reduce((m, n) => Math.min(m, n.z || 0), 0);
    let z = min;
    for (const n of selectedNodes()) n.z = --z;
    commit({ full: true });
  }

  function addEdge(fromId, toId) {
    if (fromId === toId) return;
    if (state.doc.edges.some(e => e.from === fromId && e.to === toId)) return;
    beginChange('connect');
    state.doc.edges.push({
      id: U.uid('e'), from: fromId, to: toId, fromPt: null, toPt: null,
      label: '', style: 'curve', heads: 'end', color: null,
    });
    commit({ full: true });
  }

  // A first-run page so the app never opens empty and unexplained.
  function seedDoc() {
    const d = blankDoc('Welcome');
    let z = 0;
    const mk = (o) => ({ id: U.uid(o.type), z: ++z, ...o });

    d.nodes.push(mk({
      type: 'group', x: 60, y: 40, w: 900, h: 420, label: 'Start here', color: '#7c6cff',
    }));
    d.nodes.push(mk({
      type: 'note', x: 100, y: 90, w: 380, h: 250,
      title: 'CanvasLide',
      body: 'A canvas where the blocks are notes.\n\n'
          + '- `/` inserts any block · `⌘⇧P` is every command\n'
          + '- Type `[[` to link a page — it autocompletes\n'
          + '- Type `/` inside a note for headings, lists, callouts\n'
          + '- `⌘G` shows the graph of how pages connect\n\n'
          + '> [!tip] Paste a list of lines and you get one sticky per line.',
    }));
    d.nodes.push(mk({
      type: 'todo', x: 520, y: 90, w: 300, h: 210, title: 'Try these',
      items: [
        { id: U.uid('i'), text: 'Press / and add a table', done: false },
        { id: U.uid('i'), text: 'Draw with D, comment with C', done: false },
        { id: U.uid('i'), text: 'Link to [[Ideas]]', done: false },
        { id: U.uid('i'), text: 'Open the graph with ⌘G', done: false },
      ],
    }));
    d.nodes.push(mk({
      type: 'sticky', x: 100, y: 360, w: 168, h: 80, color: '#ffd868',
      text: 'Stickies work like FigJam',
    }));
    d.nodes.push(mk({
      type: 'sticky', x: 290, y: 360, w: 168, h: 80, color: '#8fd3ff',
      text: 'Sections drag their contents',
    }));
    d.nodes.push(mk({
      type: 'note', x: 60, y: 510, w: 420, h: 190,
      title: 'Your files, your folder',
      body: 'Every page is a plain `.canvaslide.json` file in a folder you own.\n\n'
          + 'Export any page as **JSON Canvas** (`.canvas`) and it opens in '
          + 'Obsidian. Import theirs and it opens here. #open-format',
    }));
    d.nodes.push(mk({
      type: 'table', x: 520, y: 510, w: 440, h: 190,
      cols: ['Where it came from', 'What it gives you'],
      rows: [
        ['FigJam', 'infinite canvas, stickies, sections'],
        ['Notion', 'blocks, slash menu, checklists, tables'],
        ['Obsidian', 'local files, [[links]], backlinks, graph'],
      ],
    }));
    d.edges.push({ id: U.uid('e'), from: d.nodes[1].id, to: d.nodes[2].id, label: '', arrow: true });
    return d;
  }

  return {
    state, on, emit, init, doc, nodeById, selectedNodes, topZ,
    beginChange, commit, touch, undo, redo: redoAction, save,
    openPage, newPage, deletePage, renamePage, refreshIndex,
    newFolder, renameFolder, deleteFolder, movePage, toggleFolder,
    pageExists, pageByName, backlinksFor, searchAll, nodeText, nodeLabel,
    docById, embedRevision, indexDocs, tagsIn, docTags, allTags, pagesWithTag, unlinkedMentions,
    select, toggleSelect, clearSelection, setTool, setTheme, applyTheme,
    addNode, deleteSelected, duplicateSelected, bringToFront, sendToBack, addEdge,
    blankDoc,
  };
})();
