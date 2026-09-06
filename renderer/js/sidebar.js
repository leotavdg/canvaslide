'use strict';
/* ===========================================================================
   sidebar.js — the vault: pages, search, backlinks, unlinked mentions, tags.

   "Unlinked mentions" is the quiet Obsidian feature people credit with making
   a vault feel alive: it surfaces the links you meant to make and didn't.
   =========================================================================== */
App.sidebar = (() => {
  const U = App.util;
  const store = App.store;

  let listEl, searchEl, backEl, tagEl;
  let tab = 'links';
  let activeTag = null;

  function render() {
    const q = searchEl.value.trim();
    listEl.innerHTML = '';

    if (activeTag) {
      const pages = store.pagesWithTag(activeTag);
      const head = U.el('div', 'list-label', `#${U.esc(activeTag)} · ${pages.length}`);
      const clear = U.el('span', '', ' ✕');
      clear.style.cssText = 'float:right;cursor:default';
      clear.addEventListener('click', () => { activeTag = null; render(); });
      head.appendChild(clear);
      listEl.appendChild(head);
      pages.forEach(p => listEl.appendChild(pageRow(p, false)));
      renderPanes();
      return;
    }

    if (q) {
      const hits = store.searchAll(q);
      listEl.appendChild(U.el('div', 'list-label', `${hits.length} result${hits.length === 1 ? '' : 's'}`));
      for (const h of hits) {
        listEl.appendChild(pageRow({ id: h.id, name: h.name }, false));
        if (h.snippet) listEl.appendChild(U.el('div', 'hit-snippet', U.esc(h.snippet)));
      }
      renderPanes();
      return;
    }

    renderTree();
    renderPanes();
  }

  function pageRow(p, withCount) {
    const open = store.doc() && store.doc().id === p.id;
    const row = U.el('div', 'page-item' + (open ? ' active' : ''));
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/page', p.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.innerHTML = `
      <span class="pi-name">${U.esc(p.name || 'Untitled')}</span>
      ${withCount && p.nodeCount != null ? `<span class="pi-count">${p.nodeCount}</span>` : ''}
      <span class="pi-del" title="Delete page">×</span>`;
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('pi-del')) {
        if (confirm(`Delete "${p.name}"? This removes the file from your vault.`)) store.deletePage(p.id);
        return;
      }
      store.openPage(p.id);
    });
    return row;
  }

  /** The vault as a folder tree — the same tree that's on disk. */
  function renderTree() {
    const byFolder = new Map();
    for (const p of store.state.pages) {
      const f = p.folder || '';
      if (!byFolder.has(f)) byFolder.set(f, []);
      byFolder.get(f).push(p);
    }
    // folders with no pages still deserve a row
    for (const f of store.state.folders) if (!byFolder.has(f)) byFolder.set(f, []);

    const root = byFolder.get('') || [];
    byFolder.delete('');

    listEl.appendChild(U.el('div', 'list-label', 'Pages'));
    for (const p of root) listEl.appendChild(pageRow(p, true));
    listEl.appendChild(dropZone('', 'Vault root'));

    for (const name of [...byFolder.keys()].sort()) {
      const depth = name.split('/').length - 1;
      const collapsed = store.state.collapsed.has(name);
      const pages = byFolder.get(name);

      const row = U.el('div', 'folder-row');
      row.style.paddingLeft = (8 + depth * 12) + 'px';
      row.innerHTML = `
        <span class="fo-twist">${collapsed ? '▸' : '▾'}</span>
        <span class="fo-ico">${App.icons.folder}</span>
        <span class="fo-name">${U.esc(name.split('/').pop())}</span>
        <span class="fo-count">${pages.length}</span>
        <span class="fo-act" data-fo="add" title="New page here">+</span>
        <span class="fo-act" data-fo="ren" title="Rename folder">✎</span>
        <span class="fo-act" data-fo="del" title="Remove folder">×</span>`;
      row.dataset.folder = name;

      row.addEventListener('click', (e) => {
        const act = e.target.dataset.fo;
        if (act === 'add') return store.newPage('Untitled canvas', { folder: name });
        if (act === 'ren') {
          return App.app.prompt('Rename folder', name.split('/').pop(), (v) => {
            const parent = name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : '';
            if (v.trim()) store.renameFolder(name, parent + v.trim());
          });
        }
        if (act === 'del') {
          if (confirm(`Remove folder "${name}"? Its pages move back to the vault root.`)) {
            store.deleteFolder(name);
          }
          return;
        }
        store.toggleFolder(name);
      });
      wireDrop(row, name);
      listEl.appendChild(row);

      if (collapsed) continue;
      for (const p of pages) {
        const r = pageRow(p, true);
        r.style.paddingLeft = (18 + depth * 12) + 'px';
        listEl.appendChild(r);
      }
    }
  }

  /** A thin target so pages can be dragged back out to the root. */
  function dropZone(folder, label) {
    const z = U.el('div', 'drop-root', U.esc(label));
    wireDrop(z, folder);
    return z;
  }

  function wireDrop(el, folder) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drop-on');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-on'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-on');
      const id = e.dataTransfer.getData('text/page');
      if (id) store.movePage(id, folder);
    });
  }

  // ── link / tag panes ────────────────────────────────────────────────────
  function renderPanes() {
    backEl.classList.toggle('hidden', tab !== 'links');
    tagEl.classList.toggle('hidden', tab !== 'tags');
    document.querySelectorAll('.side-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab));
    tab === 'links' ? renderLinks() : renderTags();
  }

  function jumpTo(pageId, nodeId) {
    return async () => {
      await store.openPage(pageId);
      const n = store.nodeById(nodeId);
      if (n) { store.select(n.id); App.canvas.centerOn(n); }
    };
  }

  function renderLinks() {
    const d = store.doc();
    if (!d) { backEl.innerHTML = ''; return; }

    const back = store.backlinksFor(d.name);
    const unlinked = store.unlinkedMentions(d.name);
    const parts = [];

    parts.push(`<div class="list-label">Linked mentions · ${back.length}</div>`);
    backEl.innerHTML = parts.join('');

    if (!back.length) {
      backEl.appendChild(U.el('div', 'backlink',
        `<span style="color:var(--text-mute)">None yet — write [[${U.esc(d.name)}]] elsewhere.</span>`));
    }
    for (const l of back) {
      const b = U.el('div', 'backlink',
        `<b>${U.esc(l.pageName)}</b><br><span style="font-size:11px">${U.esc(l.snippet)}</span>`);
      b.addEventListener('click', jumpTo(l.pageId, l.nodeId));
      backEl.appendChild(b);
    }

    if (unlinked.length) {
      backEl.appendChild(U.el('div', 'list-label', `Unlinked mentions · ${unlinked.length}`));
      for (const l of unlinked) {
        const b = U.el('div', 'backlink',
          `<b>${U.esc(l.pageName)}</b><br><span style="font-size:11px">${U.esc(l.snippet)}</span>`);
        b.addEventListener('click', jumpTo(l.pageId, l.nodeId));
        backEl.appendChild(b);
      }
    }
  }

  function renderTags() {
    const tags = store.allTags();
    tagEl.innerHTML = `<div class="list-label">Tags · ${tags.length}</div>`;
    if (!tags.length) {
      tagEl.appendChild(U.el('div', 'backlink',
        '<span style="color:var(--text-mute)">Write #like-this in any block.</span>'));
      return;
    }
    const wrap = U.el('div');
    wrap.style.padding = '0 6px';
    for (const [name, count] of tags) {
      const chip = U.el('span', 'tag-chip' + (activeTag === name ? ' on' : ''),
        `#${U.esc(name)} <b>${count}</b>`);
      chip.addEventListener('click', () => showTag(name));
      wrap.appendChild(chip);
    }
    tagEl.appendChild(wrap);
  }

  function showTag(name) {
    activeTag = activeTag === name ? null : name;
    tab = 'tags';
    searchEl.value = '';
    render();
  }

  function mount() {
    listEl = document.getElementById('page-list');
    searchEl = document.getElementById('page-search');
    backEl = document.getElementById('backlinks');
    tagEl = document.getElementById('tagpane');

    searchEl.addEventListener('input', () => { activeTag = null; render(); });
    searchEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { searchEl.value = ''; searchEl.blur(); render(); }
    });

    document.querySelectorAll('.side-tab').forEach(b =>
      b.addEventListener('click', () => { tab = b.dataset.tab; renderPanes(); }));

    document.getElementById('btn-new-page').addEventListener('click', () => store.newPage());
    document.getElementById('btn-new-folder').addEventListener('click', () =>
      App.app.prompt('New folder name', '', (v) => { if (v.trim()) store.newFolder(v.trim()); }));
    document.getElementById('btn-reveal').addEventListener('click', () => window.api.revealVault());

    store.on('vault-changed', () => {
      const path = store.state.vaultPath || '';
      const btn = document.getElementById('btn-reveal');
      btn.textContent = path.replace(/^\/Users\/[^/]+/, '~');
      btn.title = 'Reveal ' + path;
      render();
    });
    store.on('page-opened', render);
  }

  return { mount, render, showTag };
})();
