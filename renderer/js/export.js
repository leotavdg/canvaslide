'use strict';
/* ===========================================================================
   export.js — PDF output, one section at a time.

   Each section is its own drawing, so each gets its own page: frame the
   section, hide the app chrome, capture that rectangle of the live window,
   and hand the frames to the PDF writer in the main process.

   Page size is derived from the section's size on the canvas (canvas px at
   96dpi → points), so a section drawn to a scale prints at a predictable
   physical size regardless of how far we had to zoom to capture it.
   =========================================================================== */
App.exporter = (() => {
  const U = App.util;
  const store = App.store;

  const PT_PER_PX = 0.75;                 // 96dpi CSS px → PostScript points
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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

  /** Frame `box` (world rect) in the viewport and capture it.
   *  `paper` overrides the page size when the section is a real sheet. */
  async function captureBox(box, pad = 18, paper = null) {
    const vp = App.canvas.viewportEl;
    const r = vp.getBoundingClientRect();
    const cam = store.doc().camera;

    // fit, but never magnify past 2x — beyond that we're just capturing blur
    const z = U.clamp(
      Math.min((r.width - pad * 2) / box.w, (r.height - pad * 2) / box.h), 0.05, 2);
    cam.z = z;
    cam.x = r.width / 2 - (box.x + box.w / 2) * z;
    cam.y = r.height / 2 - (box.y + box.h / 2) * z;
    App.canvas.render();
    await frame();
    await sleep(70);                       // let images/fonts settle

    const tl = App.canvas.toScreen({ x: box.x, y: box.y });
    const br = App.canvas.toScreen({ x: box.x + box.w, y: box.y + box.h });
    const rect = {
      x: r.left + Math.max(0, tl.x),
      y: r.top + Math.max(0, tl.y),
      width: Math.min(r.width, br.x - tl.x),
      height: Math.min(r.height, br.y - tl.y),
    };

    const shot = await window.api.captureRegion(rect);
    if (!shot) return null;
    return {
      b64: shot.b64, pxW: shot.pxW, pxH: shot.pxH,
      ptW: paper ? paper.w : box.w * PT_PER_PX,
      ptH: paper ? paper.h : box.h * PT_PER_PX,
    };
  }

  /** Run a capture sequence with the camera and selection restored afterwards. */
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
     that drawing sits at the page origin. Chromium prints the clones through
     its normal layout path, so every label is real text and every stroke is a
     path — no capture, no JPEG, no resolution to pick. */
  function buildPrintDoc(boxes, pageW, pageH) {
    const host = document.createElement('div');
    host.id = 'pdf-doc';
    const style = document.createElement('style');
    style.id = 'pdf-doc-style';
    style.textContent = `@page { size: ${pageW / 96}in ${pageH / 96}in; margin: 0 }`;
    document.head.appendChild(style);

    const world = document.getElementById('world');
    for (const b of boxes) {
      const page = document.createElement('div');
      page.className = 'pdf-page';
      page.style.width = pageW + 'px';
      page.style.height = pageH + 'px';

      const z = Math.min(pageW / b.w, pageH / b.h);
      const inner = world.cloneNode(true);
      inner.removeAttribute('id');
      inner.className = 'pdf-world';
      inner.style.transform = `translate(${-b.x * z}px, ${-b.y * z}px) scale(${z})`;
      inner.style.setProperty('--z', z);          // stroke widths follow the print scale
      page.appendChild(inner);
      host.appendChild(page);
    }
    const app = document.getElementById('app');
    App.canvas.viewportEl.appendChild(host);
    app.classList.add('printing');
    return () => {
      host.remove(); style.remove();
      app.classList.remove('printing');
    };
  }

  /** Print `boxes` (world rects) as pages of one PDF. */
  async function printBoxes(boxes, name, paper) {
    if (!boxes.length) return App.app.toast('Nothing to export');
    const first = boxes[0];
    const pageW = paper ? paper.w / PT_PER_PX : first.w;
    const pageH = paper ? paper.h / PT_PER_PX : first.h;
    chrome(true);
    App.canvas.render();
    await frame();
    const undo = buildPrintDoc(boxes, pageW, pageH);
    await frame();
    let saved = false;
    try {
      saved = await window.api.printPdf({
        name, widthIn: pageW / 96, heightIn: pageH / 96,
      });
    } finally {
      undo();
      chrome(false);
      App.canvas.render();
    }
    if (saved) App.app.toast(`Saved ${boxes.length} page${boxes.length > 1 ? 's' : ''} — vector PDF`);
    return saved;
  }

  const sectionBox = (g) => ({ x: g.x, y: g.y, w: g.w, h: g.h });
  /** A section marked as A3/A4/… prints at that exact paper size. */
  const sectionPaper = (g) => (g.sheet ? App.cad.sheetPt(g.sheet, g.orient) : null);

  async function sectionPdf(node) {
    const g = node || store.selectedNodes().find(n => n.type === 'group');
    if (!g) return App.app.toast('Select a section first (press F to draw one)');
    await printBoxes([sectionBox(g)], g.label || 'section', sectionPaper(g));
  }

  /** Every section becomes one page of a single PDF — a drawing set. */
  async function allSectionsPdf() {
    const groups = store.doc().nodes
      .filter(n => n.type === 'group')
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    if (!groups.length) return App.app.toast('This page has no sections');

    await printBoxes(groups.map(sectionBox), store.doc().name, sectionPaper(groups[0]));
  }

  /** The whole canvas as one page. */
  async function pagePdf() {
    const items = store.doc().nodes.filter(n => n.w > 0 && n.h > 0);
    if (!items.length) return App.app.toast('Nothing on this page');
    const b = U.bbox(items);
    const pad = 40;
    const box = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };

    await printBoxes([box], store.doc().name, null);
  }

  return { sectionPdf, allSectionsPdf, pagePdf, printBoxes, buildPrintDoc, captureBox,
           withCleanCanvas, isLight, toggleLight };
})();
