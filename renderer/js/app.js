'use strict';
/* ===========================================================================
   app.js — bootstrap + the glue: inline editing, keyboard, paste, chrome.
   =========================================================================== */
App.app = (() => {
  const U = App.util;
  const store = App.store;
  const NODES = App.nodes;
  const NBSP = /\u00a0/g;

  let titleEl, saveEl, layerNodes;

  const TOOL_KEYS = {
    v: 'select', h: 'hand', t: 'note', s: 'sticky', k: 'todo', r: 'shape',
    b: 'table', f: 'group', m: 'dim', d: 'pen', e: 'eraser', a: 'connect', c: 'comment',
  };

  const isTyping = () => {
    const a = document.activeElement;
    return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  };

  // ── toast ───────────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  /** Electron has no window.prompt, so this is ours. */
  function prompt(title, value, onOk) {
    const box = document.getElementById('prompt');
    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="prompt-box">
        <div class="prompt-title">${U.esc(title)}</div>
        <input class="prompt-input" value="${U.esc(value || '')}" />
        <div class="th-actions">
          <button class="btn-sm" data-p="cancel">Cancel</button>
          <button class="btn-sm primary" data-p="ok">OK</button>
        </div>
      </div>`;
    const input = box.querySelector('.prompt-input');
    const close = () => box.classList.add('hidden');
    const ok = () => { close(); onOk(input.value); };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') ok();
      if (e.key === 'Escape') close();
    });
    box.querySelector('[data-p="ok"]').addEventListener('click', ok);
    box.querySelector('[data-p="cancel"]').addEventListener('click', close);
    box.addEventListener('pointerdown', (e) => { if (e.target === box) close(); });
    setTimeout(() => { input.focus(); input.select(); }, 10);
  }

  /** Pick one of a short list of options. */
  function choose(title, options, onPick, opts = {}) {
    const box = document.getElementById('prompt');
    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="prompt-box">
        <div class="prompt-title">${U.esc(title)}</div>
        <div class="choose-list">
          ${options.map((o, i) => `<div class="choose-item" data-i="${i}">${U.esc(o)}</div>`).join('')}
          ${opts.allowNew ? `<div class="choose-item choose-new" data-new="1">＋ ${U.esc(opts.allowNew)}</div>` : ''}
        </div>
        <div class="th-actions"><button class="btn-sm" data-p="cancel">Cancel</button></div>
      </div>`;
    const close = () => box.classList.add('hidden');
    box.querySelectorAll('[data-i]').forEach(d => d.addEventListener('click', () => {
      close();
      onPick(options[+d.dataset.i], +d.dataset.i);
    }));
    const nw = box.querySelector('[data-new]');
    if (nw) nw.addEventListener('click', () => {
      close();
      prompt('New folder name', '', async (v) => {
        if (!v.trim()) return;
        await store.newFolder(v.trim());
        onPick(v.trim(), -1, v.trim());
      });
    });
    box.querySelector('[data-p="cancel"]').addEventListener('click', close);
    box.addEventListener('pointerdown', (e) => { if (e.target === box) close(); });
  }

  // ── inline editing ──────────────────────────────────────────────────────
  function fieldInfo(target) {
    if (!target || !target.closest) return null;
    const nodeEl = target.closest('.node');
    if (!nodeEl) return null;
    const n = store.nodeById(nodeEl.dataset.id);
    if (!n) return null;
    const holder = target.closest('[data-field],[data-act="text"],.tb-cell');
    if (!holder) return null;
    return { node: n, nodeEl, holder, field: holder.dataset.field || null };
  }

  /** Copy what's in the DOM back into the model, whichever field it is. */
  function readBack(node, holder, field) {
    const text = holder.innerText.replace(NBSP, ' ');
    // a dimension's number is applied on blur, not on every keystroke —
    // otherwise the geometry would jump around while you're still typing
    if (field === 'dimtext') return;
    if (field) {
      if (field === 'body') {
        if (holder.classList.contains('editing')) node.body = text;
      } else {
        node[field] = text;
      }
      return;
    }
    if (holder.classList.contains('tb-cell')) {
      if (holder.dataset.col != null) node.cols[+holder.dataset.col] = text;
      else if (node.rows[+holder.dataset.r]) node.rows[+holder.dataset.r][+holder.dataset.c] = text;
      return;
    }
    const row = holder.closest('[data-item]');
    if (row && node.items) {
      const item = node.items.find(i => i.id === row.dataset.item);
      if (item) item.text = text;
    }
  }

  function wireEditing() {
    layerNodes.addEventListener('focusin', (e) => {
      if (!fieldInfo(e.target)) return;
      store.beginChange('edit');
    });

    layerNodes.addEventListener('input', (e) => {
      const info = fieldInfo(e.target);
      if (!info) return;
      readBack(info.node, info.holder, info.field);
      const el = layerNodes.querySelector(`[data-id="${info.node.id}"]`);
      if (el) el._key = NODES.contentKey(info.node);   // keep the DOM patcher in sync
      store.touch();
      markDirty();
      App.suggest.onInput();
      App.slash.onInput();
    });

    layerNodes.addEventListener('focusout', (e) => {
      const info = fieldInfo(e.target);
      if (!info) return;
      App.suggest.hide();
      App.slash.hide();
      if (info.field === 'dimtext') {
        store.beginChange('dimension');
        App.cad.applyDimText(info.node, info.holder.innerText.replace(NBSP, ' '));
        info.nodeEl._key = null;
        store.commit({ full: true });
      } else if (info.field === 'body' && info.holder.classList.contains('editing')) {
        NODES.endBodyEdit(info.node, info.nodeEl);
      } else {
        info.nodeEl._key = null;
        store.commit({ full: true });
      }
    });

    // clicks: wikilinks, tags, checkboxes, table controls, embeds, links
    layerNodes.addEventListener('click', (e) => {
      const link = e.target.closest('.wikilink');
      if (link) { e.stopPropagation(); return openLink(link.dataset.link); }

      const tag = e.target.closest('.tag-inline');
      if (tag) { e.stopPropagation(); return App.sidebar.showTag(tag.dataset.tag); }

      const act = e.target.closest('[data-act]');
      if (!act) return;
      const nodeEl = act.closest('.node');
      if (!nodeEl) return;
      const node = store.nodeById(nodeEl.dataset.id);
      if (!node) return;
      const what = act.dataset.act;

      if (what === 'toggle') {
        const row = act.closest('[data-item]');
        const item = node.items.find(i => i.id === row.dataset.item);
        if (!item) return;
        store.beginChange('check');
        item.done = !item.done;
        nodeEl._key = null;
        store.commit({ full: true });
      }
      else if (what === 'add') addItem(node, node.items.length - 1);
      else if (what === 'row') {
        store.beginChange('table');
        node.rows.push(node.cols.map(() => ''));
        const needed = 60 + node.rows.length * 28;
        if (needed > node.h) node.h = needed;
        nodeEl._key = null;
        store.commit({ full: true });
      }
      else if (what === 'col') {
        store.beginChange('table');
        node.cols.push('Column');
        node.rows.forEach(r => r.push(''));
        nodeEl._key = null;
        store.commit({ full: true });
      }
      else if (what === 'open') {
        if (node.type === 'embed' && node.pageId) store.openPage(node.pageId);
        if (node.type === 'link' && node.url) window.api.openExternal(node.url);
      }
    }, true);

    // keys inside blocks
    layerNodes.addEventListener('keydown', (e) => {
      if (App.suggest.onKeyDown(e)) { e.stopPropagation(); return; }
      if (App.slash.onKeyDown(e)) { e.stopPropagation(); return; }

      const info = fieldInfo(e.target);
      if (!info) return;
      e.stopPropagation();
      const { node, holder, field, nodeEl } = info;

      // checklist: Enter adds a row, Backspace on an empty row removes it
      if (node.type === 'todo' && !field && !holder.classList.contains('tb-cell')) {
        const row = holder.closest('[data-item]');
        const idx = node.items.findIndex(i => i.id === row.dataset.item);
        if (e.key === 'Enter') { e.preventDefault(); holder.blur(); return addItem(node, idx); }
        if (e.key === 'Backspace' && !holder.innerText.trim() && node.items.length > 1) {
          e.preventDefault();
          store.beginChange('items');
          node.items.splice(idx, 1);
          nodeEl._key = null;
          store.commit({ full: true });
          return focusItem(node.id, Math.max(0, idx - 1));
        }
      }

      // table: Tab walks cells, Enter on the last row appends one
      if (node.type === 'table' && holder.classList.contains('tb-cell')) {
        if (e.key === 'Tab') {
          e.preventDefault();
          const cells = [...nodeEl.querySelectorAll('.tb-cell')];
          const next = cells[cells.indexOf(holder) + (e.shiftKey ? -1 : 1)];
          if (next) caretTo(next);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const last = holder.dataset.r != null && +holder.dataset.r === node.rows.length - 1;
          holder.blur();
          if (last) {
            store.beginChange('table');
            node.rows.push(node.cols.map(() => ''));
            nodeEl._key = null;
            store.commit({ full: true });
          }
          return;
        }
      }

      if (field === 'dimtext' && e.key === 'Enter') {
        e.preventDefault();
        return holder.blur();
      }

      if (node.type === 'note' && field === 'title' && e.key === 'Enter') {
        e.preventDefault();
        holder.blur();
        return NODES.beginBodyEdit(node, nodeEl);
      }

      if (e.key === 'Escape') { e.preventDefault(); holder.blur(); }
    });
  }

  function addItem(node, afterIdx) {
    store.beginChange('items');
    const item = { id: U.uid('i'), text: '', done: false };
    node.items.splice(afterIdx + 1, 0, item);
    const el = layerNodes.querySelector(`[data-id="${node.id}"]`);
    if (el) el._key = null;
    const needed = 52 + node.items.length * 24;
    if (needed > node.h) node.h = needed;
    store.commit({ full: true });
    focusItem(node.id, afterIdx + 1);
  }

  function caretTo(el) {
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function focusItem(nodeId, idx) {
    requestAnimationFrame(() => {
      const el = layerNodes.querySelector(`[data-id="${nodeId}"]`);
      if (!el) return;
      const rows = el.querySelectorAll('.t-text');
      caretTo(rows[U.clamp(idx, 0, rows.length - 1)]);
    });
  }

  // ── wikilinks & pages ───────────────────────────────────────────────────
  async function openLink(name) {
    const p = store.pageByName(name);
    if (p) return store.openPage(p.id);
    return store.newPage(name);
  }

  async function promoteNoteToPage(node) {
    if (!node || node.type !== 'note') return toast('Select a note first');
    const name = (node.title || 'Untitled').trim() || 'Untitled';
    const page = store.blankDoc(name);
    page.nodes.push({ ...NODES.create('note', 80, 80, { title: name, body: node.body }), z: 1 });
    await window.api.writePage(page);
    await store.refreshIndex();

    store.beginChange('promote');
    node.body = `See [[${name}]]`;
    const el = layerNodes.querySelector(`[data-id="${node.id}"]`);
    if (el) el._key = null;
    store.commit({ full: true });
    toast(`Created page “${name}”`);
  }

  // ── toolbar ─────────────────────────────────────────────────────────────
  function wireToolbar() {
    document.querySelectorAll('.tool').forEach(b =>
      b.addEventListener('click', () => store.setTool(b.dataset.tool)));
    store.on('tool-changed', (t) => {
      document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
      App.canvas.viewportEl.className = 'tool-' + t;
      if (t !== 'connect') App.canvas.cancelPending();
      const arrowEl = document.getElementById('arrow-options');
      arrowEl.classList.toggle('hidden', t !== 'connect');
      if (t === 'connect') App.arrows.renderOptions(arrowEl);
    });
  }

  // ── keyboard ────────────────────────────────────────────────────────────
  const runCmd = (id) => {
    const c = App.commands.all().find(x => x.id === id);
    if (c) c.run();
  };

  function wireKeys() {
    window.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (App.suggest.onKeyDown(e)) return;
      if (App.slash.onKeyDown(e)) return;

      if (e.key === 'Escape') {
        if (App.canvas.cancelPending()) return;
        if (App.commands.isOpen()) return App.commands.close();
        if (App.graph.isOpen()) return App.graph.close();
        if (isTyping()) return document.activeElement.blur();
        store.clearSelection();
        return store.setTool('select');
      }

      // the palette must be reachable even mid-typing
      if (meta && e.shiftKey && key === 'p') { e.preventDefault(); return App.commands.open(); }
      if (isTyping()) return;

      if (e.code === 'Space') { App.canvas.setSpace(true); return e.preventDefault(); }

      if (meta) {
        if (key === 'z') { e.preventDefault(); return e.shiftKey ? store.redo() : store.undo(); }
        if (key === 'd' && e.shiftKey) { e.preventDefault(); return App.daily.open(); }
        if (key === 'd') { e.preventDefault(); return store.duplicateSelected(); }
        if (key === 'a' && e.shiftKey) { e.preventDefault(); return runCmd('sel.similar'); }
        if (key === 'a') { e.preventDefault(); return store.select(store.doc().nodes.map(n => n.id)); }
        if (key === 'g' && e.shiftKey) { e.preventDefault(); return App.groups.wrapSelection(); }
        if (key === 'g') { e.preventDefault(); return App.graph.toggle(); }
        if (key === 'o' && e.shiftKey) { e.preventDefault(); return App.panels.toggleOutline(); }
        if (key === 'k') { e.preventDefault(); return App.commands.open(); }
        if (e.key === '0') { e.preventDefault(); return App.canvas.zoomTo(1); }
        if (e.key === '=' || e.key === '+') { e.preventDefault(); return App.canvas.zoomTo(store.doc().camera.z * 1.2); }
        if (e.key === '-') { e.preventDefault(); return App.canvas.zoomTo(store.doc().camera.z / 1.2); }
        return;
      }

      if (e.key === '/') { e.preventDefault(); return App.commands.open({ mode: 'insert' }); }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); return store.deleteSelected(); }
      if (e.key === '1' && e.shiftKey) { e.preventDefault(); return App.canvas.zoomToFit(); }
      if (e.key === '2' && e.shiftKey) { e.preventDefault(); return App.canvas.zoomToSelection(); }
      if (e.key === 'Enter' && store.state.selection.size === 1) {
        e.preventDefault();
        return App.canvas.focusNode([...store.state.selection][0]);
      }

      const t = TOOL_KEYS[key];
      if (t) { e.preventDefault(); return store.setTool(t); }

      if (e.key.startsWith('Arrow') && store.state.selection.size) {
        e.preventDefault();
        const step = e.shiftKey ? 24 : 8;
        store.beginChange('nudge');
        for (const n of App.groups.withChildren([...store.state.selection])) {
          if (e.key === 'ArrowLeft') n.x -= step;
          if (e.key === 'ArrowRight') n.x += step;
          if (e.key === 'ArrowUp') n.y -= step;
          if (e.key === 'ArrowDown') n.y += step;
        }
        store.commit({ full: true });
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') App.canvas.setSpace(false);
    });
  }

  // ── paste & drop ────────────────────────────────────────────────────────
  /** FigJam/Miro's most-praised bulk trick: paste a list and get one sticky
   *  per line; paste a spreadsheet range (TSV) and get a grid of them. */
  function stickiesFromText(text, origin) {
    const rows = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (rows.length < 2) return false;

    const grid = rows.map(r => r.split('\t'));
    const cols = Math.max(...grid.map(r => r.length));
    const W = 168, H = 168, GAP = 18;

    store.beginChange('paste');
    const made = [];
    grid.forEach((row, r) => {
      for (let c = 0; c < cols; c++) {
        const cell = (row[c] || '').trim();
        if (!cell) continue;
        const n = NODES.create('sticky', origin.x + c * (W + GAP), origin.y + r * (H + GAP), {
          w: W, h: H, text: cell,
          color: App.palette.sticky[c % App.palette.sticky.length],
        });
        n.z = store.topZ() + 1 + made.length;
        store.doc().nodes.push(n);
        made.push(n.id);
      }
    });
    store.commit({ full: true });
    store.select(made);
    App.canvas.zoomToSelection();
    toast(`${made.length} stickies from ${cols > 1 ? 'that table' : 'that list'}`);
    return true;
  }

  async function imageNodeFrom(file, at) {
    const dataUrl = await new Promise(res => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(file);
    });
    const rel = await window.api.saveAsset({ name: file.name || 'pasted.png', dataUrl });
    return new Promise(res => {
      const probe = new Image();
      probe.onload = () => {
        const scale = Math.min(1, 420 / probe.width);
        res(store.addNode(NODES.create('image', at.x, at.y, {
          src: `file://${store.state.vaultPath}/${rel}`,
          w: Math.round(probe.width * scale),
          h: Math.round(probe.height * scale),
        })));
      };
      probe.src = dataUrl;
    });
  }

  function wirePaste() {
    window.addEventListener('paste', async (e) => {
      if (isTyping()) return;
      const items = [...(e.clipboardData ? e.clipboardData.items : [])];
      const img = items.find(i => i.type.startsWith('image/'));
      const r = App.canvas.viewportEl.getBoundingClientRect();
      const centre = App.canvas.toWorld({ x: r.width / 2, y: r.height / 2 });

      if (img) {
        e.preventDefault();
        return void imageNodeFrom(img.getAsFile(), { x: centre.x - 160, y: centre.y - 110 });
      }

      const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (!text || !text.trim()) return;
      e.preventDefault();

      if (stickiesFromText(text, { x: centre.x - 200, y: centre.y - 120 })) return;
      const lines = text.split('\n');
      store.addNode(NODES.create('note', centre.x - 160, centre.y - 100, {
        title: lines[0].slice(0, 60),
        body: lines.slice(1).join('\n'),
      }));
    });

    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
      const rect = App.canvas.viewportEl.getBoundingClientRect();
      let w = App.canvas.toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });

      for (const file of files) {
        if (file.type.startsWith('image/')) {
          await imageNodeFrom(file, w);
          w = { x: w.x + 26, y: w.y + 26 };
        } else if (/\.canvas$/i.test(file.name)) {
          toast('Use File → Import .canvas for canvas files');
        }
      }
    });
  }

  // ── chrome ──────────────────────────────────────────────────────────────
  function markDirty() { saveEl.textContent = 'saving…'; saveEl.classList.add('dirty'); }

  function wireChrome() {
    titleEl.addEventListener('input', () => { store.renamePage(titleEl.value); markDirty(); });
    titleEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') titleEl.blur();
    });

    const unitsBtn = document.getElementById('btn-units');
    const unitsPop = document.getElementById('units-pop');
    unitsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const showing = unitsPop.classList.toggle('hidden');
      if (!showing) {
        App.cad.renderOptions(unitsPop);
        const b = unitsBtn.getBoundingClientRect();
        unitsPop.style.top = (b.bottom + 8) + 'px';
        unitsPop.style.right = (window.innerWidth - b.right) + 'px';
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (unitsPop.classList.contains('hidden')) return;
      if (unitsPop.contains(e.target) || e.target === unitsBtn) return;
      unitsPop.classList.add('hidden');
    });

    App.sheet.wire();
    document.getElementById('btn-fit').addEventListener('click', () => App.canvas.zoomToFit());
    document.getElementById('btn-graph').addEventListener('click', () => App.graph.toggle());
    document.getElementById('btn-outline').addEventListener('click', () => App.panels.toggleOutline());
    document.getElementById('btn-toggle-side').addEventListener('click', toggleSidebar);

    store.on('saved', () => { saveEl.textContent = 'saved'; saveEl.classList.remove('dirty'); });
    store.on('dirty', markDirty);
    store.on('page-opened', (d) => {
      titleEl.value = d.name;
      store.applyTheme();
      refreshUnitChip();
      App.canvas.render();
    });
    document.getElementById('btn-theme').addEventListener('click', () =>
      store.setTheme(store.doc().theme === 'drafting' ? 'studio' : 'drafting'));
    store.on('doc-changed', refreshUnitChip);
    store.on('doc-changed', () => App.canvas.render());
  }

  function refreshUnitChip() {
    const b = document.getElementById('btn-units');
    if (b && App.cad) b.textContent = App.cad.chipLabel();
  }

  function toggleSidebar() { document.getElementById('app').classList.toggle('side-hidden'); }

  function wireMenu() {
    const on = window.api.onMenu;
    on('menu:new-page', () => store.newPage());
    on('menu:switcher', () => App.commands.open());
    on('menu:palette', () => App.commands.open());
    on('menu:undo', () => store.undo());
    on('menu:redo', () => store.redo());
    on('menu:zoom-fit', () => App.canvas.zoomToFit());
    on('menu:zoom-sel', () => App.canvas.zoomToSelection());
    on('menu:zoom-100', () => App.canvas.zoomTo(1));
    on('menu:toggle-sidebar', toggleSidebar);
    on('menu:export-png', exportPng);
    on('menu:export-canvas', () => App.jsoncanvas.exportCurrent());
    on('menu:export-md', () => App.jsoncanvas.exportMarkdown());
    on('menu:import-canvas', () => App.jsoncanvas.importFile());
    on('menu:daily', () => App.daily.open());
    on('menu:pdf-section', () => App.exporter.sectionPdf());
    on('menu:pdf-all', () => App.exporter.allSectionsPdf());
    on('menu:pdf-page', () => App.exporter.pagePdf());
    on('menu:graph', () => App.graph.toggle());
    on('menu:outline', () => App.panels.toggleOutline());
    on('menu:change-vault', async () => {
      const p = await window.api.chooseVault();
      if (!p) return;
      store.state.vaultPath = p;
      await store.refreshIndex();
      if (store.state.pages[0]) store.openPage(store.state.pages[0].id);
    });
  }

  async function exportPng() {
    App.canvas.zoomToFit(60);
    store.clearSelection();
    App.canvas.render();
    await new Promise(r => setTimeout(r, 140));
    const r = App.canvas.viewportEl.getBoundingClientRect();
    const ok = await window.api.exportPng({
      name: store.doc().name,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    });
    if (ok) toast('PNG saved');
  }

  // ── boot ────────────────────────────────────────────────────────────────
  async function boot() {
    titleEl = document.getElementById('page-title');
    saveEl = document.getElementById('save-state');
    layerNodes = document.getElementById('layer-nodes');

    App.canvas.mount();
    App.comments.mount();
    App.sidebar.mount();
    App.inspector.mount();
    App.commands.mount();
    App.suggest.mount();
    App.slash.mount();
    App.graph.mount();
    App.panels.mount();

    if (localStorage.getItem('showSelection') === 'yes') {
      document.getElementById('app').classList.add('show-selection');
    }

    wireToolbar();
    wireEditing();
    wireKeys();
    wirePaste();
    wireChrome();
    wireMenu();

    store.on('selection-changed', () => App.canvas.renderOverlay());
    store.on('vault-changed', () => App.canvas.render());
    window.addEventListener('resize', () => { App.canvas.renderOverlay(); App.panels.drawMinimap(); });
    window.addEventListener('beforeunload', () => { if (store.state.dirty) store.save(); });

    await store.init();
    store.setTool('select');
    App.sidebar.render();
    App.canvas.render();
    App.panels.refresh();
  }

  return { boot, toast, prompt, choose, refreshUnitChip, promoteNoteToPage, openLink, toggleSidebar, exportPng, stickiesFromText };
})();

document.addEventListener('DOMContentLoaded', () => App.app.boot());
