'use strict';
/* ===========================================================================
   export.js — PDF and PNG output, one section at a time.

   Each section is its own drawing, so each gets its own page. Chromium prints
   a clone of the canvas for every page through its normal layout path, so
   every label is real text and every stroke is a path — no capture, no JPEG,
   no resolution to pick.

   Page size comes from the section: a section marked as A3/A4/… prints at
   exactly that paper size; any other section prints at its canvas size
   (canvas px at 96dpi → points). Each page carries its own size, so a drawing
   set can mix sheets.
   =========================================================================== */
App.exporter = (() => {
  const U = App.util;
  const store = App.store;

  const PT_PER_PX = 0.75;                 // 96dpi CSS px → PostScript points
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Drawings get printed, and nobody prints on black — default to a white page.
  let light = localStorage.getItem('pdfLight') !== 'no';
  let active = false;
  const isLight = () => active && light;

  function toggleLight() {
    light = !light;
    localStorage.setItem('pdfLight', light ? 'yes' : 'no');
    App.app.toast(`PDF background: ${light ? 'white' : 'dark'}`);
  }

  /** Hide everything that isn't the drawing, and repaint for the page colour. */
  function chrome(on) {
    active = on;
    const app = document.getElementById('app');
    app.classList.toggle('exporting', on);
    app.classList.toggle('on-white', on && light);
    // colours baked into SVG attributes need a forced re-render
    document.querySelectorAll('#layer-nodes .node').forEach(el => { el._key = null; });
  }

  /** Run something with the chrome hidden and the camera and selection
   *  restored afterwards — used by the PNG export. */
  async function withCleanCanvas(fn) {
    const cam = { ...store.doc().camera };
    const sel = [...store.state.selection];
    store.clearSelection();
    chrome(true);
    App.canvas.render();
    await frame();
    try {
      return await fn();
    } finally {
      chrome(false);
      Object.assign(store.doc().camera, cam);
      if (sel.length) store.select(sel);
      App.canvas.render();
    }
  }

  /* ── vector output ──────────────────────────────────────────────────────
     One .pdf-page per drawing, each holding a *clone* of #world positioned so
     that drawing sits at the page origin. Every page gets a named @page rule
     with its own size. */
  function buildPrintDoc(pages) {
    const host = document.createElement('div');
    host.id = 'pdf-doc';
    const style = document.createElement('style');
    style.id = 'pdf-doc-style';
    style.textContent = pages.map((p, i) =>
      `@page sheet${i} { size: ${p.pageW / 96}in ${p.pageH / 96}in; margin: 0 }\n` +
      `.pdf-page[data-sheet="${i}"] { page: sheet${i} }`).join('\n');
    document.head.appendChild(style);

    const world = document.getElementById('world');
    pages.forEach((p, i) => {
      const b = p.box;
      const page = document.createElement('div');
      page.className = 'pdf-page';
      page.dataset.sheet = String(i);
      page.style.width = p.pageW + 'px';
      page.style.height = p.pageH + 'px';

      const z = Math.min(p.pageW / b.w, p.pageH / b.h);
      const inner = world.cloneNode(true);
      inner.removeAttribute('id');
      inner.className = 'pdf-world';
      inner.style.transform = `translate(${-b.x * z}px, ${-b.y * z}px) scale(${z})`;
      inner.style.setProperty('--z', z);          // stroke widths follow the print scale
      page.appendChild(inner);
      host.appendChild(page);
    });
    const app = document.getElementById('app');
    App.canvas.viewportEl.appendChild(host);
    app.classList.add('printing');
    return () => {
      host.remove(); style.remove();
      app.classList.remove('printing');
    };
  }

  /** A page spec for a world box: paper (pt) if it is a real sheet, else the
   *  box's own size. pageW/pageH are CSS px. */
  function pageFor(box, paper) {
    return {
      box,
      pageW: paper ? paper.w / PT_PER_PX : box.w,
      pageH: paper ? paper.h / PT_PER_PX : box.h,
    };
  }

  /** Print `pages` ([{box, pageW, pageH}]) as one PDF. */
  async function printPages(pages, name) {
    if (!pages.length) return App.app.toast('Nothing to export');
    chrome(true);
    App.canvas.render();
    await frame();
    const undo = buildPrintDoc(pages);
    await frame();
    let saved = false;
    try {
      saved = await window.api.printPdf({
        name, widthIn: pages[0].pageW / 96, heightIn: pages[0].pageH / 96,
      });
    } finally {
      undo();
      chrome(false);
      App.canvas.render();
    }
    if (saved) App.app.toast(`Saved ${pages.length} page${pages.length > 1 ? 's' : ''} — vector PDF`);
    return saved;
  }

  const sectionBox = (g) => ({ x: g.x, y: g.y, w: g.w, h: g.h });
  /** A section marked as A3/A4/… prints at that exact paper size. */
  const sectionPaper = (g) => (g.sheet ? App.cad.sheetPt(g.sheet, g.orient) : null);
  const sectionPage = (g) => pageFor(sectionBox(g), sectionPaper(g));

  async function sectionPdf(node) {
    const g = node || store.selectedNodes().find(n => n.type === 'group');
    if (!g) return App.app.toast('Select a section first (press F to draw one)');
    await printPages([sectionPage(g)], g.label || 'section');
  }

  /** Every section becomes one page of a single PDF — a drawing set, each
   *  sheet at its own size. */
  async function allSectionsPdf() {
    const groups = store.doc().nodes
      .filter(n => n.type === 'group')
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    if (!groups.length) return App.app.toast('This page has no sections');
    await printPages(groups.map(sectionPage), store.doc().name);
  }

  /** The whole canvas as one page. */
  async function pagePdf() {
    const items = store.doc().nodes.filter(n => n.w > 0 && n.h > 0);
    if (!items.length) return App.app.toast('Nothing on this page');
    const b = U.bbox(items);
    const pad = 40;
    const box = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    await printPages([pageFor(box, null)], store.doc().name);
  }

  return { sectionPdf, allSectionsPdf, pagePdf, printPages, buildPrintDoc, pageFor,
           withCleanCanvas, isLight, toggleLight };
})();
