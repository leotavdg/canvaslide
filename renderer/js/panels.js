'use strict';
/* ===========================================================================
   panels.js — minimap + outline.

   Two answers to the loudest complaint about canvas tools: "somewhere on this
   board something changed and I can't find it", and Obsidian Canvas's
   "navigation is the weakest point". The minimap shows where you are; the
   outline is the whole canvas as a list you can click through — which is also
   the escape hatch for people who'd rather read than pan.
   =========================================================================== */
App.panels = (() => {
  const U = App.util;
  const store = App.store;

  let mini, miniSvg, outline, outlineList;
  let showMini = true, showOutline = false;

  // ── minimap ─────────────────────────────────────────────────────────────
  const MINI_W = 190, MINI_H = 130, PAD = 10;

  function drawMinimap() {
    if (!showMini || !store.doc()) return;
    const d = store.doc();
    const items = d.nodes.filter(n => n.w > 0 && n.h > 0);
    const vp = App.canvas.viewportEl.getBoundingClientRect();
    const cam = d.camera;

    // include the current viewport so the indicator is always on-map
    const viewBox = {
      x: -cam.x / cam.z, y: -cam.y / cam.z,
      w: vp.width / cam.z, h: vp.height / cam.z,
    };
    const box = U.bbox([...items, viewBox]) || viewBox;
    const scale = Math.min((MINI_W - PAD * 2) / Math.max(box.w, 1), (MINI_H - PAD * 2) / Math.max(box.h, 1));
    const ox = PAD - box.x * scale + (MINI_W - PAD * 2 - box.w * scale) / 2;
    const oy = PAD - box.y * scale + (MINI_H - PAD * 2 - box.h * scale) / 2;
    const X = (v) => v * scale + ox;
    const Y = (v) => v * scale + oy;

    const parts = [];
    for (const n of items) {
      const sel = store.state.selection.has(n.id);
      const fill = n.type === 'group' ? 'transparent'
        : n.type === 'sticky' ? (n.color || '#ffd868')
        : n.type === 'ink' ? 'var(--good)'
        : sel ? 'var(--accent)' : '#5a5a68';
      parts.push(`<rect x="${X(n.x)}" y="${Y(n.y)}" width="${Math.max(1.5, n.w * scale)}"
        height="${Math.max(1.5, n.h * scale)}" rx="1.5" fill="${fill}"
        stroke="${n.type === 'group' ? 'var(--line)' : (sel ? 'var(--accent)' : 'none')}" stroke-width="1"/>`);
    }
    parts.push(`<rect class="mm-view" x="${X(viewBox.x)}" y="${Y(viewBox.y)}"
      width="${viewBox.w * scale}" height="${viewBox.h * scale}" rx="2"/>`);

    miniSvg.innerHTML = parts.join('');
    miniSvg._map = { scale, ox, oy };
  }

  /** Click/drag the minimap to fly the camera there. */
  function miniJump(e) {
    const m = miniSvg._map;
    if (!m) return;
    const r = miniSvg.getBoundingClientRect();
    const wx = (e.clientX - r.left - m.ox) / m.scale;
    const wy = (e.clientY - r.top - m.oy) / m.scale;
    App.canvas.centerOnPoint({ x: wx, y: wy });
  }

  function toggleMinimap() {
    showMini = !showMini;
    mini.classList.toggle('hidden', !showMini);
    if (showMini) drawMinimap();
  }

  // ── outline ─────────────────────────────────────────────────────────────
  const ICON = {
    note: '📄', sticky: '🟨', todo: '☑', shape: '▭', image: '🖼',
    ink: '✏️', table: '▦', group: '⬚', embed: '🔗', link: '🌐',
  };

  function drawOutline() {
    if (!showOutline || !store.doc()) return;
    const d = store.doc();
    const groups = d.nodes.filter(n => n.type === 'group').sort((a, b) => a.y - b.y);
    const claimed = new Set();
    const rows = [];

    for (const g of groups) {
      const kids = App.groups.childrenOf(g).sort((a, b) => (a.y - b.y) || (a.x - b.x));
      kids.forEach(k => claimed.add(k.id));
      rows.push({ node: g, depth: 0 });
      kids.forEach(k => rows.push({ node: k, depth: 1 }));
    }
    const loose = d.nodes
      .filter(n => n.type !== 'group' && !claimed.has(n.id))
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    loose.forEach(n => rows.push({ node: n, depth: 0 }));

    const openTasks = d.nodes
      .filter(n => n.type === 'todo')
      .flatMap(n => (n.items || []).filter(i => !i.done && i.text.trim()).map(i => ({ n, i })));

    outlineList.innerHTML = `
      ${openTasks.length ? `<div class="list-label">Open tasks · ${openTasks.length}</div>
        ${openTasks.slice(0, 12).map(t => `
          <div class="ol-row ol-task" data-id="${t.n.id}">
            <span class="ol-ico">☐</span><span class="ol-text">${U.esc(t.i.text)}</span></div>`).join('')}` : ''}
      <div class="list-label">On this canvas · ${d.nodes.length}</div>
      ${rows.map(r => `
        <div class="ol-row${store.state.selection.has(r.node.id) ? ' on' : ''}"
             data-id="${r.node.id}" style="padding-left:${8 + r.depth * 15}px">
          <span class="ol-ico">${ICON[r.node.type] || '•'}</span>
          <span class="ol-text">${U.esc(store.nodeLabel(r.node))}</span>
        </div>`).join('')}
      ${d.comments && d.comments.length ? `<div class="list-label">Comments · ${d.comments.length}</div>
        ${d.comments.map(c => `<div class="ol-row ol-comment" data-cid="${c.id}">
          <span class="ol-ico">${c.resolved ? '✓' : '💬'}</span>
          <span class="ol-text">${U.esc((c.messages[0] || {}).text || 'empty')}</span></div>`).join('')}` : ''}`;

    outlineList.querySelectorAll('[data-id]').forEach(row => {
      row.addEventListener('click', () => {
        const n = store.nodeById(row.dataset.id);
        if (!n) return;
        store.select(n.id);
        App.canvas.centerOn(n);
      });
    });
    outlineList.querySelectorAll('[data-cid]').forEach(row => {
      row.addEventListener('click', () => {
        const c = store.doc().comments.find(x => x.id === row.dataset.cid);
        if (!c) return;
        App.canvas.centerOnPoint(App.comments.posOf(c));
        setTimeout(() => App.comments.open(c.id, { compose: false }), 60);
      });
    });
  }

  function toggleOutline() {
    showOutline = !showOutline;
    outline.classList.toggle('hidden', !showOutline);
    document.getElementById('app').classList.toggle('has-outline', showOutline);
    if (showOutline) drawOutline();
  }

  function refresh() { drawMinimap(); drawOutline(); }

  function mount() {
    mini = document.getElementById('minimap');
    miniSvg = document.getElementById('minimap-svg');
    outline = document.getElementById('outline');
    outlineList = document.getElementById('outline-list');

    miniSvg.setAttribute('viewBox', `0 0 ${MINI_W} ${MINI_H}`);
    let dragging = false;
    miniSvg.addEventListener('pointerdown', (e) => {
      dragging = true; miniSvg.setPointerCapture(e.pointerId); miniJump(e);
    });
    miniSvg.addEventListener('pointermove', (e) => { if (dragging) miniJump(e); });
    miniSvg.addEventListener('pointerup', (e) => {
      dragging = false;
      try { miniSvg.releasePointerCapture(e.pointerId); } catch (_) {}
    });

    document.getElementById('outline-close').addEventListener('click', toggleOutline);

    store.on('doc-changed', refresh);
    store.on('selection-changed', refresh);
    store.on('page-opened', refresh);
    mini.classList.toggle('hidden', !showMini);
    outline.classList.toggle('hidden', !showOutline);
  }

  return { mount, refresh, drawMinimap, drawOutline, toggleMinimap, toggleOutline };
})();
