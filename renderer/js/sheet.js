'use strict';
/* ===========================================================================
   sheet.js — the page's paper: background, grid, line weight, label floor.

   These are properties of the drawing, not of the app, so they live on the
   document (`doc.sheet`) and travel with the file. Everything is applied as
   CSS custom properties, which is why nothing here has to repaint nodes:

     --z         live camera scale          (set by canvas.applyCamera)
     --lw        line-weight multiplier     -> stroke width, clamped at 1px
     --fs-min    label floor in screen px   -> labels never shrink away
     --grid      minor grid colour
     --grid-major major grid colour
   =========================================================================== */
App.sheet = (() => {
  const store = () => App.store;

  const DEFAULTS = {
    drafting: { bg: '#ffffff', grid: '#dfe3e9', gridMajor: 'rgba(0,0,0,.10)' },
    studio:   { bg: '',        grid: '',        gridMajor: '' },
  };
  const BASE = { lw: 1, fsMin: 13 };

  /** The page's sheet settings, filled in from the theme's defaults. */
  function current() {
    const d = store().doc();
    const theme = (d && d.theme) || 'studio';
    return { ...DEFAULTS[theme], ...BASE, ...((d && d.sheet) || {}) };
  }

  /** Push the settings onto the DOM. Cheap enough to call on every change. */
  function apply() {
    const d = store().doc();
    if (!d) return;
    const s = current();
    const vp = document.getElementById('viewport');
    const world = document.getElementById('world');
    if (!vp || !world) return;

    setVar(vp, 'background-color', s.bg, true);
    setVar(vp, '--grid', s.grid);
    setVar(vp, '--grid-major', s.gridMajor);
    world.style.setProperty('--lw', s.lw);
    world.style.setProperty('--fs-min', s.fsMin);

    const chip = document.getElementById('btn-sheet');
    if (chip) chip.innerHTML = `<i class="sheet-sw" style="background:${
      s.bg || 'var(--bg)'};border-color:${s.grid || 'var(--line)'}"></i>Sheet`;
    if (App.canvas) App.canvas.applyCamera();   // repaints the grid image
  }

  function setVar(el, prop, value, plain) {
    if (value) el.style.setProperty(prop, value);
    else el.style.removeProperty(prop);
    if (plain) return;
  }

  /** Write one setting through the undo stack. */
  function set(key, value) {
    const d = store().doc();
    if (!d) return;
    store().beginChange('sheet');
    d.sheet = { ...current(), ...{ [key]: value } };
    apply();
    store().commit({ full: false });
  }

  function reset() {
    const d = store().doc();
    if (!d) return;
    store().beginChange('sheet');
    delete d.sheet;
    apply();
    store().commit({ full: false });
    render(document.getElementById('sheet-pop'));
  }

  // ── the popover ─────────────────────────────────────────────────────────
  function render(el) {
    if (!el) return;
    const s = current();
    el.innerHTML = `
      <div class="units-panel">
        <div class="units-row">
          <span class="units-label">Paper</span>
          <input type="color" data-sh="bg" value="${hex(s.bg, '#ffffff')}">
          <span class="units-hint">page background</span>
        </div>
        <div class="units-row">
          <span class="units-label">Grid</span>
          <input type="color" data-sh="grid" value="${hex(s.grid, '#dfe3e9')}">
          <input type="color" data-sh="gridMajor" value="${hex(s.gridMajor, '#c8ccd3')}">
          <span class="units-hint">minor · major</span>
        </div>
        <div class="units-row">
          <span class="units-label">Lines</span>
          <input type="range" min="0.5" max="6" step="0.5" value="${s.lw}" data-sh="lw"
                 style="width:120px;accent-color:var(--accent)">
          <span class="units-eq" data-out="lw">${s.lw}×</span>
        </div>
        <div class="units-row">
          <span class="units-label">Text</span>
          <input type="range" min="8" max="200" step="1" value="${pageFs()}" data-fs-all
                 style="width:120px;accent-color:var(--accent)">
          <span class="units-eq" data-out="fsall">${pageFs()} on every block</span>
        </div>
        <div class="units-hint">Text is sized in drawing units and does not rescale
          itself — set it here for the whole page, or per block in the inspector
          (it works on a multiple selection).</div>
        <div class="units-row"><button class="unit-btn" data-sh-reset>Reset to theme</button></div>
      </div>`;

    el.querySelectorAll('[data-sh]').forEach(inp => {
      const key = inp.dataset.sh;
      const evt = inp.type === 'range' ? 'input' : 'change';
      inp.addEventListener(evt, () => {
        const v = inp.type === 'range' ? +inp.value : inp.value;
        set(key, v);
        const out = el.querySelector(`[data-out="${key}"]`);
        if (out) out.textContent = key === 'lw' ? `${v}×` : `${v}px floor`;
      });
    });
    const all = el.querySelector('[data-fs-all]');
    if (all) all.addEventListener('input', () => {
      const d = store().doc();
      if (!d) return;
      store().beginChange('label size');
      for (const n of d.nodes) {
        if (n.type === 'shape' && n.text) n.fs = +all.value;
        else if (['dim', 'group', 'note', 'todo', 'table', 'sticky'].includes(n.type)) n.fs = +all.value;
        else continue;
        const el2 = document.querySelector(`[data-id="${n.id}"]`);
        if (el2) el2._key = null;
      }
      store().commit({ full: true });
      const out = el.querySelector('[data-out="fsall"]');
      if (out) out.textContent = `${all.value} on every block`;
    });

    const rst = el.querySelector('[data-sh-reset]');
    if (rst) rst.addEventListener('click', reset);
  }

  /** The label size shared by the page's labelled blocks, for the slider. */
  function pageFs() {
    const d = store().doc();
    const sizes = d ? d.nodes.filter(n => n.type === 'shape' && n.text).map(n => n.fs == null ? 13 : n.fs) : [];
    return sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 13;
  }

  /** <input type=color> only speaks #rrggbb, so fall back for rgba()/''. */
  function hex(v, fallback) {
    return /^#[0-9a-f]{6}$/i.test(v || '') ? v : fallback;
  }

  function wire() {
    const btn = document.getElementById('btn-sheet');
    const pop = document.getElementById('sheet-pop');
    if (!btn || !pop) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const hidden = pop.classList.toggle('hidden');
      if (hidden) return;
      render(pop);
      const b = btn.getBoundingClientRect();
      pop.style.top = (b.bottom + 8) + 'px';
      pop.style.right = (window.innerWidth - b.right) + 'px';
    });
    document.addEventListener('pointerdown', (e) => {
      if (pop.classList.contains('hidden')) return;
      if (pop.contains(e.target) || e.target === btn || btn.contains(e.target)) return;
      pop.classList.add('hidden');
    });
  }

  return { apply, current, set, reset, wire, render };
})();
