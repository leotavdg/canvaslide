'use strict';
/* ===========================================================================
   inspector.js — contextual panel for the current selection, plus the
   pen options strip that appears while the draw/erase tools are active.
   =========================================================================== */
App.inspector = (() => {
  const U = App.util;
  const store = App.store;
  let el, penEl, cadEl;

  function render() {
    const sel = store.selectedNodes();
    const tool = store.state.tool;

    penEl.classList.toggle('hidden', tool !== 'pen');
    if (tool === 'pen') renderPen();

    cadEl.classList.toggle('hidden', tool !== 'dim');
    if (tool === 'dim') App.cad.renderOptions(cadEl);

    // an arrow can be selected with no blocks selected
    if (!sel.length && store.state.selectedEdge && tool !== 'pen' && tool !== 'dim') {
      el.classList.remove('hidden');
      return renderArrow();
    }

    if (!sel.length || tool === 'pen' || tool === 'dim') { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');

    const kinds = new Set(sel.map(n => n.type));
    const one = sel.length === 1 ? sel[0] : null;
    const parts = [];

    parts.push(`<div class="insp-label">${sel.length === 1 ? one.type : sel.length + ' selected'}</div>`);

    if (kinds.has('sticky')) {
      parts.push('<div class="insp-label">Colour</div><div class="swatches">');
      for (const c of App.palette.sticky) {
        const on = one && one.color === c ? ' on' : '';
        parts.push(`<div class="swatch${on}" data-sticky="${c}" style="background:${c}"></div>`);
      }
      parts.push('</div>');
    }

    if (kinds.has('shape')) {
      parts.push('<div class="insp-label">Colour</div><div class="swatches">');
      for (const c of App.palette.shape) {
        const on = one && one.color === c ? ' on' : '';
        parts.push(`<div class="swatch${on}" data-shape="${c}" style="background:${c}"></div>`);
      }
      parts.push('</div><div class="insp-label">Shape</div><div class="insp-row">');
      for (const k of ['rect', 'ellipse', 'diamond']) {
        parts.push(`<button class="btn-sm${one && one.kind === k ? ' primary' : ''}" data-kind="${k}">${k}</button>`);
      }
      parts.push(`</div><div class="insp-row" style="margin-top:6px">
        <button class="btn-sm" data-a="fill">${one && one.filled ? 'Outline' : 'Fill'}</button></div>`);
    }

    if (kinds.has('group')) {
      parts.push('<div class="insp-label">Section colour</div><div class="swatches">');
      for (const c of App.palette.shape) {
        const on = one && one.color === c ? ' on' : '';
        parts.push(`<div class="swatch${on}" data-group="${c}" style="background:${c}"></div>`);
      }
      parts.push('</div>');
    }

    if (kinds.has('ink')) {
      parts.push('<div class="insp-label">Ink colour</div><div class="swatches">');
      for (const c of App.palette.ink) {
        parts.push(`<div class="swatch" data-ink="${c}" style="background:${c}"></div>`);
      }
      parts.push('</div>');
    }

    if (sel.length > 1) {
      parts.push(`<div class="insp-label">Align ${sel.length} items</div><div class="insp-row">
        <button class="btn-sm" data-al="left"   title="Align left">⇤</button>
        <button class="btn-sm" data-al="centre" title="Align centres">⇹</button>
        <button class="btn-sm" data-al="right"  title="Align right">⇥</button>
        <button class="btn-sm" data-al="top"    title="Align top">⤒</button>
        <button class="btn-sm" data-al="middle" title="Align middles">⇳</button>
        <button class="btn-sm" data-al="bottom" title="Align bottom">⤓</button>
      </div>
      <div class="insp-row" style="margin-top:5px">
        <button class="btn-sm" data-dist="h">Space across</button>
        <button class="btn-sm" data-dist="v">Space down</button>
      </div>
      <div class="insp-row" style="margin-top:5px">
        <button class="btn-sm" data-a="tidy">Tidy into grid</button>
        <button class="btn-sm" data-a="section">Wrap in section</button>
      </div>`);
    }

    parts.push(`<div class="insp-label">Arrange</div><div class="insp-row">
      <button class="btn-sm" data-a="front">Front</button>
      <button class="btn-sm" data-a="back">Back</button>
      <button class="btn-sm" data-a="dupe">Duplicate</button>
      <button class="btn-sm" data-a="del">Delete</button>
    </div>`);

    if (one && one.type === 'embed') {
      parts.push(`<div class="insp-label">Embed</div><div class="insp-row">
        <button class="btn-sm" data-a="openembed">Open page →</button>
        <button class="btn-sm" data-a="rebind">Point elsewhere</button></div>`);
    }

    if (one && one.type === 'table') {
      parts.push(`<div class="insp-label">Table</div><div class="insp-row">
        <button class="btn-sm" data-a="delrow">− row</button>
        <button class="btn-sm" data-a="delcol">− column</button></div>`);
    }

    if (kinds.has('dim')) {
      parts.push('<div class="insp-label">Dimension colour</div><div class="swatches">');
      for (const c of App.palette.ink) {
        const on = one && one.color === c ? ' on' : '';
        parts.push(`<div class="swatch${on}" data-dimcol="${c}" style="background:${c}"></div>`);
      }
      parts.push(`</div><div class="insp-row" style="margin-top:6px">
        <button class="btn-sm" data-a="relabel">Override text</button>
        <button class="btn-sm" data-a="flip">Flip side</button></div>`);
      parts.push(`<div class="insp-label">Thickness</div>
        <input type="range" min="0.5" max="8" step="0.5" value="${
          one && one.weight != null ? one.weight : 1}"
               data-dimweight style="width:100%;accent-color:var(--accent)">`);
    }

    if (kinds.has('group')) {
      const kids = sel.filter(n => n.type === 'group')
        .flatMap(g => App.groups.childrenOf(g)).length;
      parts.push(`<div class="insp-label">Contents · ${kids}</div><div class="insp-row">
        <button class="btn-sm primary" data-a="selkids">Select contents</button>
        <button class="btn-sm" data-a="selkids-add">Add to selection</button></div>
        <div style="font-size:11px;color:var(--text-mute);line-height:1.5;margin:4px 0 8px">
          Or double-click the section frame. Dragging the frame moves the section
          and everything in it; selecting the contents moves them out of it.
        </div>`);
      parts.push(`<div class="insp-label">Export</div><div class="insp-row">
        <button class="btn-sm primary" data-a="pdfsection">Section → PDF</button>
        <button class="btn-sm" data-a="pdfall">All sections → PDF</button></div>`);
    }

    if (kinds.has('shape')) {
      const shapes = sel.filter(n => n.type === 'shape');
      const sw0 = shapes[0].stroke == null ? 2 : shapes[0].stroke;
      const mixedSw = shapes.some(n => (n.stroke == null ? 2 : n.stroke) !== sw0);
      parts.push(`<div class="insp-label">Stroke${mixedSw ? ' · mixed' : ''}</div>
        <input type="range" min="0" max="10" step="1" value="${sw0}"
               data-strokew style="width:100%;accent-color:var(--accent)">`);
    }

    // Text size works on everything selected that carries text, so you can
    // set a whole drawing's labels in one go.
    const texty = sel.filter(n => ['shape', 'dim', 'group', 'note', 'todo', 'table'].includes(n.type));
    if (texty.length) {
      const DEF = { shape: 13, dim: 11.5, group: 12, note: 13, todo: 13, table: 13 };
      const cur = texty[0].fs == null ? DEF[texty[0].type] : texty[0].fs;
      const mixed = texty.some(n => (n.fs == null ? DEF[n.type] : n.fs) !== cur);
      parts.push(`<div class="insp-label">Text size · <b data-fslabel>${
                    mixed ? 'mixed' : cur}</b> on ${texty.length} ${texty.length === 1 ? 'block' : 'blocks'}</div>
        <input type="range" min="6" max="300" step="1" value="${cur}"
               data-fs style="width:100%;accent-color:var(--accent)">`);
    }

    if (one && one.type === 'note') {
      parts.push(`<div class="insp-label">Note</div><div class="insp-row">
        <button class="btn-sm" data-a="topage">Turn into page →</button></div>`);
    }

    el.innerHTML = parts.join('');
    wire(sel);
  }

  /** A 3x3 pad mirroring the block's corners, plus "free" in the middle. */
  function mountGrid(which, current) {
    const rows = [['nw', 'n', 'ne'], ['w', 'c', 'e'], ['sw', 's', 'se']];
    return `<div class="insp-label">${which === 0 ? 'Start' : 'End'} mount</div>
      <div class="mount-grid">
        ${rows.map(r => r.map(k => {
          const mid = k === 'c';
          return `<button class="mount-cell${current === k ? ' on' : ''}" data-mount="${which}"
            data-anchor="${k}" title="${mid ? 'centre of the block' : k}">${mid ? '•' : ''}</button>`;
        }).join('')).join('')}
      </div>
      <div class="insp-row">
        <button class="btn-sm${!current ? ' primary' : ''}" data-mount="${which}" data-anchor=""
                title="slides around the border to face the other end">float</button>
      </div>`;
  }

  function renderArrow() {
    const e = App.arrows.selected();
    if (!e) { el.classList.add('hidden'); return; }
    const pin = (end) => end ? (end === e.from ? (e.fromAnchor ? `mounted ${e.fromAnchor}` : 'floating on a block')
                                              : (e.toAnchor ? `mounted ${e.toAnchor}` : 'floating on a block'))
                             : 'loose';
    el.innerHTML = `
      <div class="insp-label">arrow</div>
      <div class="insp-label">Shape</div>
      <div class="insp-row">
        ${App.arrows.STYLES.map(k =>
          `<button class="btn-sm${e.style === k ? ' primary' : ''}" data-estyle="${k}">${k}</button>`).join('')}
      </div>
      <div class="insp-label">Ends</div>
      <div class="insp-row">
        ${App.arrows.HEADS.map(h =>
          `<button class="btn-sm${(e.heads || 'end') === h.id ? ' primary' : ''}" data-eheads="${h.id}">${h.label}</button>`).join('')}
      </div>
      <div class="insp-label">Thickness · <b data-ewout>${e.weight == null ? 1 : e.weight}</b>×</div>
      <input type="range" min="0.5" max="8" step="0.5" value="${e.weight == null ? 1 : e.weight}"
             data-eweight style="width:100%;accent-color:var(--accent)">
      <div class="insp-label">Colour</div>
      <div class="swatches">
        <div class="swatch${!e.color ? ' on' : ''}" data-ecol="" style="background:var(--text-mute)"></div>
        ${App.palette.ink.map(c =>
          `<div class="swatch${e.color === c ? ' on' : ''}" data-ecol="${c}" style="background:${c}"></div>`).join('')}
      </div>
      ${e.from ? mountGrid(0, e.fromAnchor) : ''}
      ${e.to ? mountGrid(1, e.toAnchor) : ''}
      <div style="font-size:11px;color:var(--text-mute);line-height:1.5;margin-top:6px">
        start: ${pin(e.from)}<br>end: ${pin(e.to)}<br>
        drag a grip onto a corner to mount it there
      </div>
      <div class="insp-label">Arrow</div>
      <div class="insp-row">
        <button class="btn-sm" data-earr="label">${e.label ? 'Edit label' : 'Add label'}</button>
        <button class="btn-sm" data-earr="reverse">Reverse</button>
        <button class="btn-sm" data-earr="del">Delete</button>
      </div>`;

    const change = (fn) => { store.beginChange('arrow'); fn(); store.commit({ full: true }); };
    el.querySelectorAll('[data-mount]').forEach(b => b.addEventListener('click', () => change(() => {
      const key = b.dataset.anchor || null;
      if (b.dataset.mount === '0') e.fromAnchor = key; else e.toAnchor = key;
    })));
    const ew = el.querySelector('[data-eweight]');
    if (ew) ew.addEventListener('input', () => {
      store.beginChange('thickness');
      e.weight = +ew.value;
      const out = el.querySelector('[data-ewout]');
      if (out) out.textContent = ew.value;
      store.commit({ full: true });
    });
    el.querySelectorAll('[data-estyle]').forEach(b =>
      b.addEventListener('click', () => change(() => { e.style = b.dataset.estyle; })));
    el.querySelectorAll('[data-eheads]').forEach(b =>
      b.addEventListener('click', () => change(() => { e.heads = b.dataset.eheads; })));
    el.querySelectorAll('[data-ecol]').forEach(b =>
      b.addEventListener('click', () => change(() => { e.color = b.dataset.ecol || null; })));
    el.querySelectorAll('[data-earr]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.earr;
      if (a === 'del') { store.deleteSelected(); return; }
      if (a === 'reverse') return change(() => {
        const f = e.from, fp = e.fromPt;
        e.from = e.to; e.fromPt = e.toPt;
        e.to = f; e.toPt = fp;
      });
      if (a === 'label') App.app.prompt('Arrow label', e.label || '', (v) => change(() => { e.label = v.trim(); }));
    }));
  }

  function wire(sel) {
    el.querySelectorAll('[data-sticky]').forEach(s => s.addEventListener('click', () => {
      store.beginChange('color');
      for (const n of sel) if (n.type === 'sticky') n.color = s.dataset.sticky;
      store.state.lastSticky = s.dataset.sticky;
      store.commit({ full: true });
    }));

    el.querySelectorAll('[data-shape]').forEach(s => s.addEventListener('click', () => {
      store.beginChange('color');
      for (const n of sel) if (n.type === 'shape') n.color = s.dataset.shape;
      store.commit({ full: true });
    }));

    el.querySelectorAll('[data-ink]').forEach(s => s.addEventListener('click', () => {
      store.beginChange('color');
      for (const n of sel) if (n.type === 'ink') for (const st of n.strokes) st.color = s.dataset.ink;
      store.commit({ full: true });
    }));

    el.querySelectorAll('[data-group]').forEach(s2 => s2.addEventListener('click', () => {
      store.beginChange('color');
      for (const n of sel) if (n.type === 'group') n.color = s2.dataset.group;
      store.commit({ full: true });
    }));

    el.querySelectorAll('[data-dimcol]').forEach(s2 => s2.addEventListener('click', () => {
      store.beginChange('color');
      for (const n of sel) if (n.type === 'dim') n.color = s2.dataset.dimcol;
      sel.forEach(n => { const e2 = document.querySelector(`[data-id="${n.id}"]`); if (e2) e2._key = null; });
      store.commit({ full: true });
    }));

    const sw = el.querySelector('[data-strokew]');
    if (sw) sw.addEventListener('input', () => {
      store.beginChange('stroke');
      for (const n of sel) if (n.type === 'shape') n.stroke = +sw.value;
      store.commit({ full: true });
    });

    const dw = el.querySelector('[data-dimweight]');
    if (dw) dw.addEventListener('input', () => {
      store.beginChange('thickness');
      for (const n of sel) if (n.type === 'dim') { n.weight = +dw.value; const e2 =
        document.querySelector(`[data-id="${n.id}"]`); if (e2) e2._key = null; }
      store.commit({ full: true });
    });

    const fs = el.querySelector('[data-fs]');
    if (fs) fs.addEventListener('input', () => {
      store.beginChange('text size');
      for (const n of sel) {
        if (!['shape', 'dim', 'group', 'note', 'todo', 'table'].includes(n.type)) continue;
        n.fs = +fs.value;
        const e2 = document.querySelector(`[data-id="${n.id}"]`);
        if (e2) e2._key = null;                       // dims and sections repaint
      }
      const out = el.querySelector('[data-fslabel]');
      if (out) out.textContent = fs.value;
      store.commit({ full: true });
    });

    el.querySelectorAll('[data-al]').forEach(b => b.addEventListener('click', () =>
      App.arrange.align(b.dataset.al)));
    el.querySelectorAll('[data-dist]').forEach(b => b.addEventListener('click', () =>
      App.arrange.distribute(b.dataset.dist)));

    el.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
      store.beginChange('shape');
      for (const n of sel) if (n.type === 'shape') n.kind = b.dataset.kind;
      store.commit({ full: true });
    }));

    el.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'selkids' || a === 'selkids-add') {
        const kids = sel.filter(n => n.type === 'group').flatMap(g => App.groups.childrenOf(g));
        if (kids.length) store.select(kids.map(n => n.id), a === 'selkids-add');
        return;
      }
      if (a === 'front') store.bringToFront();
      if (a === 'back') store.sendToBack();
      if (a === 'dupe') store.duplicateSelected();
      if (a === 'del') store.deleteSelected();
      if (a === 'fill') {
        store.beginChange('fill');
        for (const n of sel) if (n.type === 'shape') n.filled = !n.filled;
        store.commit({ full: true });
      }
      if (a === 'topage') App.app.promoteNoteToPage(sel[0]);
      if (a === 'pdfsection') App.exporter.sectionPdf(sel.find(n => n.type === 'group'));
      if (a === 'pdfall') App.exporter.allSectionsPdf();
      if (a === 'relabel') App.commands.all().find(c => c.id === 'cad.relabel').run();
      if (a === 'flip') {
        store.beginChange('dim');
        for (const n of sel) if (n.type === 'dim') { n.off = -(n.off || 0); App.cad.reflowDim(n); }
        sel.forEach(n => { const e2 = document.querySelector(`[data-id="${n.id}"]`); if (e2) e2._key = null; });
        store.commit({ full: true });
      }
      if (a === 'tidy') App.arrange.tidy();
      if (a === 'section') App.groups.wrapSelection();
      if (a === 'openembed' && sel[0].pageId) store.openPage(sel[0].pageId);
      if (a === 'rebind') {
        const target = sel[0];
        App.commands.open({ mode: 'page', placeholder: 'Embed which page?', onPick: (p) => {
          store.beginChange('embed');
          target.pageId = p.id; target.pageName = p.name;
          store.commit({ full: true });
        } });
      }
      if (a === 'delrow' && sel[0].rows.length > 1) {
        store.beginChange('table'); sel[0].rows.pop(); store.commit({ full: true });
      }
      if (a === 'delcol' && sel[0].cols.length > 1) {
        store.beginChange('table');
        sel[0].cols.pop(); sel[0].rows.forEach(r => r.pop());
        store.commit({ full: true });
      }
    }));
  }

  function renderPen() {
    const pen = store.state.pen;
    penEl.innerHTML = `
      <div class="swatches">${App.palette.ink.map(c =>
        `<div class="swatch${pen.color === c ? ' on' : ''}" data-pen="${c}" style="background:${c}"></div>`).join('')}</div>
      <input type="range" min="1" max="18" step="1" value="${pen.size}" data-pensize>
      <span style="font-size:11px;color:var(--text-mute);width:24px">${pen.size}px</span>`;
    penEl.querySelectorAll('[data-pen]').forEach(s => s.addEventListener('click', () => {
      pen.color = s.dataset.pen; renderPen();
    }));
    penEl.querySelector('[data-pensize]').addEventListener('input', (e) => {
      pen.size = +e.target.value; renderPen();
    });
  }

  function mount() {
    el = document.getElementById('inspector');
    penEl = document.getElementById('pen-options');
    cadEl = document.getElementById('cad-options');
    store.on('selection-changed', render);
    store.on('tool-changed', render);
    store.on('doc-changed', render);
  }

  return { mount, render };
})();
