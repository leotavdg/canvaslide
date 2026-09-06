'use strict';
/* ===========================================================================
   cad.js — drafting: real dimensions, a drawing scale, and snapping to geometry.

   A dimension is a first-class object like anything else on the canvas: two
   measured points plus a perpendicular offset. It stores its points relative
   to its own origin (same trick as ink) so dragging it moves everything.

   The page carries a scale — "1 canvas px = N units" — so a dimension reads
   out in mm, inches, feet, whatever the drawing is in.
   =========================================================================== */
App.cad = (() => {
  const U = App.util;
  const store = App.store;

  // ── drawing scale ───────────────────────────────────────────────────────
  const DEFAULT_SCALE = { perPx: 1, unit: 'px', decimals: 1 };

  function scale() {
    const d = store.doc();
    if (!d) return DEFAULT_SCALE;
    if (!d.scale) d.scale = { ...DEFAULT_SCALE };
    return d.scale;
  }
  const scaleKey = () => {
    const s = scale();
    return `${s.perPx}${s.unit}${s.decimals}`;
  };

  /** Format a length in canvas px as a display string in the page's units. */
  function measure(px) {
    const s = scale();
    const v = px * (s.perPx || 1);
    const d = s.decimals == null ? 1 : s.decimals;
    const txt = v.toFixed(d);
    return `${txt}${s.unit === 'px' ? '' : ' '}${s.unit}`;
  }

  function setScale(patch) {
    const d = store.doc();
    if (!d) return;
    store.beginChange('scale');
    d.scale = { ...scale(), ...patch };
    // every dimension's label depends on the scale
    for (const n of d.nodes) {
      if (n.type === 'dim') {
        const el = document.querySelector(`[data-id="${n.id}"]`);
        if (el) el._key = null;
      }
    }
    store.commit({ full: true });
  }

  // ── geometry ────────────────────────────────────────────────────────────
  const PAD = 30;   // room for the dimension line, arrows and text

  /** Recompute a dimension's box from its points, re-basing them to 0,0. */
  function reflowDim(n) {
    const [a, b] = n.pts;
    const off = n.off || 0;
    const { nx, ny } = normalOf(a, b);
    const q = [
      [a[0] + nx * off, a[1] + ny * off],
      [b[0] + nx * off, b[1] + ny * off],
    ];
    const xs = [a[0], b[0], q[0][0], q[1][0]];
    const ys = [a[1], b[1], q[0][1], q[1][1]];
    const x1 = Math.min(...xs) - PAD, y1 = Math.min(...ys) - PAD;
    const x2 = Math.max(...xs) + PAD, y2 = Math.max(...ys) + PAD;
    if (x1 || y1) {
      for (const p of n.pts) { p[0] -= x1; p[1] -= y1; }
      n.x += x1; n.y += y1;
    }
    n.w = Math.round(x2 - x1);
    n.h = Math.round(y2 - y1);
  }

  function normalOf(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return { nx: -dy / len, ny: dx / len, dx: dx / len, dy: dy / len, len };
  }

  /** Absolute world position of a dimension's measured points and line ends. */
  function dimGeometry(n) {
    const a = [n.x + n.pts[0][0], n.y + n.pts[0][1]];
    const b = [n.x + n.pts[1][0], n.y + n.pts[1][1]];
    const { nx, ny, len } = normalOf(a, b);
    const off = n.off || 0;
    return {
      a, b, len,
      q1: [a[0] + nx * off, a[1] + ny * off],
      q2: [b[0] + nx * off, b[1] + ny * off],
      nx, ny,
    };
  }

  // ── rendering ───────────────────────────────────────────────────────────
  function renderDim(node) {
    const n = { ...node, color: U.forPrint(node.color) };
    const [a, b] = n.pts;
    const { nx, ny, dx, dy, len } = normalOf(a, b);
    const off = n.off || 0;
    const q1 = [a[0] + nx * off, a[1] + ny * off];
    const q2 = [b[0] + nx * off, b[1] + ny * off];

    // extension lines run from just off the measured point to just past the line
    const gap = 4, over = 7;
    const e1a = [a[0] + nx * Math.sign(off || 1) * gap, a[1] + ny * Math.sign(off || 1) * gap];
    const e1b = [a[0] + nx * (off + Math.sign(off || 1) * over), a[1] + ny * (off + Math.sign(off || 1) * over)];
    const e2a = [b[0] + nx * Math.sign(off || 1) * gap, b[1] + ny * Math.sign(off || 1) * gap];
    const e2b = [b[0] + nx * (off + Math.sign(off || 1) * over), b[1] + ny * (off + Math.sign(off || 1) * over)];

    const arrow = (tip, ux, uy) => {
      const L = 9, W = 3.4;
      const p1 = [tip[0] + ux * L + -uy * W, tip[1] + uy * L + ux * W];
      const p2 = [tip[0] + ux * L - -uy * W, tip[1] + uy * L - ux * W];
      return `<polygon points="${r(tip)} ${r(p1)} ${r(p2)}" fill="${n.color}"/>`;
    };

    const label = n.label || measure(len);
    const mid = [(q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2];
    let deg = Math.atan2(dy, dx) * 180 / Math.PI;
    if (deg > 90 || deg < -90) deg += 180;          // keep text upright

    return `<svg width="100%" height="100%" viewBox="0 0 ${Math.max(n.w, 1)} ${Math.max(n.h, 1)}"
                 style="--ew:${n.weight == null ? 1 : n.weight}">
      <line x1="${r1(e1a[0])}" y1="${r1(e1a[1])}" x2="${r1(e1b[0])}" y2="${r1(e1b[1])}"
            stroke="${n.color}" stroke-width="1" opacity=".75" vector-effect="non-scaling-stroke"/>
      <line x1="${r1(e2a[0])}" y1="${r1(e2a[1])}" x2="${r1(e2b[0])}" y2="${r1(e2b[1])}"
            stroke="${n.color}" stroke-width="1" opacity=".75" vector-effect="non-scaling-stroke"/>
      <line x1="${r1(q1[0])}" y1="${r1(q1[1])}" x2="${r1(q2[0])}" y2="${r1(q2[1])}"
            stroke="${n.color}" stroke-width="1.3" vector-effect="non-scaling-stroke"/>
      ${arrow(q1, dx, dy)}
      ${arrow(q2, -dx, -dy)}
    </svg>
    <div class="dim-label" data-field="dimtext" contenteditable="true"
         style="--fs:${n.fs == null ? 11.5 : n.fs};
                left:${r1(mid[0])}px; top:${r1(mid[1])}px;
                transform: translate(-50%,-50%) rotate(${r1(deg)}deg);
                color:${n.color}">${U.esc(label)}</div>`;
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  const r = (p) => `${r1(p[0])},${r1(p[1])}`;

  // ── snapping to existing geometry ───────────────────────────────────────
  /** Candidate snap points on a node: corners, edge midpoints, centre. */
  function pointsOf(n) {
    const { x, y, w, h } = n;
    return [
      [x, y], [x + w, y], [x, y + h], [x + w, y + h],
      [x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2],
      [x + w / 2, y + h / 2],
    ];
  }

  /** Nearest snap point to a world position, or null. `tol` is in world units. */
  function snapPoint(world, tol, excludeId) {
    let best = null;
    for (const n of store.doc().nodes) {
      if (n.id === excludeId || n.w <= 0 || n.type === 'dim') continue;
      for (const p of pointsOf(n)) {
        const d = Math.hypot(p[0] - world.x, p[1] - world.y);
        if (d <= tol && (!best || d < best.d)) best = { p, d, node: n };
      }
    }
    return best;
  }

  /** Typing into a dimension: a number re-drives the geometry, anything else
   *  becomes a text override. This is what makes a dimension *driving* rather
   *  than merely reporting. */
  function applyDimText(n, raw) {
    const text = String(raw || '').trim();
    const m = /^-?[\d.,]+/.exec(text.replace(/\s/g, ''));
    const value = m ? parseFloat(m[0].replace(/,/g, '')) : NaN;

    if (!text) { n.label = ''; return true; }
    if (!isFinite(value) || value <= 0) { n.label = text; return true; }

    n.label = '';
    const px = value / (scale().perPx || 1);
    return driveTo(n, px);
  }

  /** Set a dimension's measured length to `px`, resizing whatever it spans. */
  function driveTo(n, px) {
    const g = dimGeometry(n);
    const cur = g.len || 1;
    if (Math.abs(px - cur) < 0.01) return false;
    const ux = (g.b[0] - g.a[0]) / cur, uy = (g.b[1] - g.a[1]) / cur;

    const host = spannedNode(n, g);
    if (host) {
      // the dimension measures this block's width or height: resize the block
      const horiz = Math.abs(uy) < 0.02;
      const vert = Math.abs(ux) < 0.02;
      if (horiz) {
        if (Math.abs(g.a[0] - host.x) < Math.abs(g.b[0] - host.x)) host.w = Math.round(px);
        else { host.x = Math.round(host.x + host.w - px); host.w = Math.round(px); }
      } else if (vert) {
        if (Math.abs(g.a[1] - host.y) < Math.abs(g.b[1] - host.y)) host.h = Math.round(px);
        else { host.y = Math.round(host.y + host.h - px); host.h = Math.round(px); }
      }
    }

    // move the far end along the same direction so the reading matches
    n.pts[1] = [n.pts[0][0] + ux * px, n.pts[0][1] + uy * px];
    reflowDim(n);
    return true;
  }

  /** The block a dimension measures edge-to-edge, if there is one. */
  function spannedNode(n, g) {
    const TOL = 2.5;
    for (const node of store.doc().nodes) {
      if (node.type === 'dim' || node.type === 'group' || node.w <= 0) continue;
      const onBox = (p) =>
        p[0] >= node.x - TOL && p[0] <= node.x + node.w + TOL &&
        p[1] >= node.y - TOL && p[1] <= node.y + node.h + TOL;
      if (!onBox(g.a) || !onBox(g.b)) continue;
      const spansW = Math.abs(Math.abs(g.a[0] - g.b[0]) - node.w) < TOL;
      const spansH = Math.abs(Math.abs(g.a[1] - g.b[1]) - node.h) < TOL;
      if (spansW || spansH) return node;
    }
    return null;
  }

  /** Lock `p` to a horizontal or vertical line through `anchor`.
   *  `slack` lets the pen stay free until the stroke is clearly one or the
   *  other. Returns {x, y, axis} where axis is 'h', 'v' or null. */
  function constrain(anchor, p, on, slack) {
    if (!on || !anchor) return { x: p.x, y: p.y, axis: null };
    const dx = p.x - anchor.x, dy = p.y - anchor.y;
    if (slack && Math.abs(Math.abs(dx) - Math.abs(dy)) < slack) {
      return { x: p.x, y: p.y, axis: null };
    }
    return Math.abs(dx) >= Math.abs(dy)
      ? { x: p.x, y: anchor.y, axis: 'h' }
      : { x: anchor.x, y: p.y, axis: 'v' };
  }

  /** Is a snap candidate still on the locked axis? Keeps ⇧ strict. */
  function onAxis(anchor, pt, axis) {
    if (!axis) return true;
    return axis === 'h' ? Math.abs(pt[1] - anchor.y) < 2
                        : Math.abs(pt[0] - anchor.x) < 2;
  }

  /** Build a dimension between two world points.
   *  Drafting convention puts the dimension line outside the part, so pick the
   *  offset sign that points away from the thing being measured. */
  function createDim(aWorld, bWorld) {
    const n = App.nodes.create('dim', 0, 0);
    const a = [aWorld.x, aWorld.y], b = [bWorld.x, bWorld.y];
    const { nx, ny } = normalOf(a, b);
    const mid = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };

    let off = 26;
    const host = nearestHost(mid);
    if (host) {
      const cx = host.x + host.w / 2, cy = host.y + host.h / 2;
      // negative dot = the normal already points away from the part's centre
      if ((mid.x - cx) * nx + (mid.y - cy) * ny < 0) off = -off;
    }
    n.pts = [a, b];
    n.off = off;
    reflowDim(n);
    return n;
  }

  /** The smallest node whose box contains `p` — the thing being dimensioned. */
  function nearestHost(p) {
    let best = null;
    for (const n of store.doc().nodes) {
      if (n.type === 'dim' || n.type === 'group' || n.w <= 0) continue;
      const pad = 3;
      if (p.x >= n.x - pad && p.x <= n.x + n.w + pad &&
          p.y >= n.y - pad && p.y <= n.y + n.h + pad) {
        const area = n.w * n.h;
        if (!best || area < best.area) best = { node: n, area };
      }
    }
    return best && best.node;
  }

  // ── the options strip shown while the dimension tool is active ──────────
  // How many of each unit fit in one millimetre — lets us convert the scale
  // when you switch units, instead of silently changing what a drawing means.
  const UNITS = [
    { id: 'px', label: 'px', perMm: null },     // screen pixels: no physical size
    { id: 'mm', label: 'mm', perMm: 1 },
    { id: 'cm', label: 'cm', perMm: 0.1 },
    { id: 'm',  label: 'm',  perMm: 0.001 },
    { id: 'in', label: 'in', perMm: 1 / 25.4 },
    { id: 'ft', label: 'ft', perMm: 1 / 304.8 },
    { id: 'yd', label: 'yd', perMm: 1 / 914.4 },
    { id: 'pt', label: 'pt', perMm: 72 / 25.4 },
    { id: 'thou', label: 'thou', perMm: 1000 / 25.4 },
  ];
  const unitDef = (id) => UNITS.find(u => u.id === id) || UNITS[0];

  /** Switch units, keeping the drawing the same physical size where we can. */
  function setUnit(next) {
    const s = scale();
    const from = unitDef(s.unit), to = unitDef(next);
    let perPx = s.perPx;
    if (from.perMm && to.perMm) perPx = tidy((s.perPx / from.perMm) * to.perMm);
    const decimals = to.id === 'm' ? 3 : to.id === 'in' || to.id === 'ft' ? 2 : 1;
    setScale({ unit: next, perPx, decimals: s.decimals != null && s.unit !== 'px' ? s.decimals : decimals });
  }

  /** Trim floating-point dust from a converted scale. */
  function tidy(v) {
    if (!isFinite(v) || v === 0) return v;
    const digits = Math.max(0, 6 - Math.floor(Math.log10(Math.abs(v))) - 1);
    return Number(v.toFixed(Math.min(10, digits)));
  }

  // ── sheets ──────────────────────────────────────────────────────────────
  /** Standard paper, in millimetres, portrait. */
  const PAPER = {
    A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297],
    Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8],
  };
  const PAPER_NAMES = Object.keys(PAPER);

  /** How many millimetres one canvas pixel represents on this page. */
  function mmPerPx() {
    const s = scale();
    const u = unitDef(s.unit);
    if (!u.perMm) return 1;          // page is in raw pixels: treat 1px = 1mm
    return (s.perPx || 1) / u.perMm;
  }

  /** A sheet's size in canvas px, so it lands at true size for the page scale. */
  function sheetPx(name, orient) {
    const mm = PAPER[name];
    if (!mm) return null;
    const [w, h] = orient === 'landscape' ? [mm[1], mm[0]] : mm;
    const k = mmPerPx();
    return { w: Math.round(w / k), h: Math.round(h / k) };
  }

  /** The same sheet in PostScript points, for PDF page size. */
  function sheetPt(name, orient) {
    const mm = PAPER[name];
    if (!mm) return null;
    const [w, h] = orient === 'landscape' ? [mm[1], mm[0]] : mm;
    return { w: w * 72 / 25.4, h: h * 72 / 25.4 };
  }

  /** Resize a section to a paper size and remember which one it is. */
  function applySheet(group, name, orient) {
    const px = sheetPx(name, orient);
    if (!px) return;
    group.sheet = name;
    group.orient = orient;
    group.w = px.w;
    group.h = px.h;
  }

  /** Common drafting scales, expressed as canvas-px per unit. */
  const PRESETS = [
    { label: '1:1',   f: 1 },
    { label: '1:2',   f: 2 },
    { label: '1:5',   f: 5 },
    { label: '1:10',  f: 10 },
    { label: '1:20',  f: 20 },
    { label: '1:50',  f: 50 },
    { label: '1:100', f: 100 },
  ];

  function renderOptions(el, opts = {}) {
    const s = scale();
    const compact = !!opts.compact;
    el.innerHTML = `
      <div class="units-panel">
        <div class="units-row">
          <span class="units-label">Units</span>
          <div class="unit-pick">
            ${UNITS.map(u => `<button class="unit-btn${u.id === s.unit ? ' on' : ''}"
              data-unit="${u.id}">${u.label}</button>`).join('')}
          </div>
        </div>
        <div class="units-row">
          <span class="units-label">Scale</span>
          <span class="units-eq">1 px =</span>
          <input type="number" step="0.0001" min="0.0001" value="${s.perPx}" data-cad="perPx">
          <span class="units-eq">${s.unit}</span>
          <span class="units-label" style="margin-left:10px">Decimals</span>
          <input type="number" min="0" max="4" value="${s.decimals}" data-cad="decimals" style="width:48px">
        </div>
        <div class="units-row">
          <span class="units-label">Preset</span>
          ${PRESETS.map(p => `<button class="unit-btn" data-preset="${p.f}">${p.label}</button>`).join('')}
        </div>
        ${compact ? '' : `<div class="units-hint">
          Applies to this page. Dimensions re-read themselves immediately.</div>`}
      </div>`;

    el.querySelectorAll('[data-unit]').forEach(b =>
      b.addEventListener('click', () => { setUnit(b.dataset.unit); rerender(el, opts); }));

    el.querySelectorAll('[data-preset]').forEach(b =>
      b.addEventListener('click', () => {
        // "1:50" means one drawing unit on screen equals 50 real ones
        setScale({ perPx: Number(b.dataset.preset) });
        rerender(el, opts);
      }));

    el.querySelectorAll('[data-cad]').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') inp.blur();
      });
      inp.addEventListener('change', () => {
        setScale({ [inp.dataset.cad]: Number(inp.value) });
        rerender(el, opts);
      });
    });
  }

  function rerender(el, opts) {
    renderOptions(el, opts);
    if (App.app && App.app.refreshUnitChip) App.app.refreshUnitChip();
  }

  /** Short label for the topbar chip. */
  function chipLabel() {
    const s = scale();
    if (s.unit === 'px') return 'px';
    const n = Number(s.perPx);
    const shown = Number.isInteger(n) ? n : Number(n.toPrecision(4));
    return `${s.unit} · 1px = ${shown}`;
  }

  return {
    scale, scaleKey, measure, setScale,
    reflowDim, renderDim, dimGeometry, normalOf,
    snapPoint, pointsOf, createDim, nearestHost, renderOptions, UNITS, unitDef,
    setUnit, chipLabel, PRESETS, tidy,
    PAPER, PAPER_NAMES, mmPerPx, sheetPx, sheetPt, applySheet,
    constrain, onAxis, applyDimText, driveTo, spannedNode,
  };
})();
