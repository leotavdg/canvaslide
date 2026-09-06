'use strict';
/* ===========================================================================
   arrows.js — connectors and standalone arrows.

   An arrow has two ends, and each end is independently either **pinned to a
   block** (it follows that block around, meeting its edge) or **free** at a
   fixed point. That one idea covers all the cases people expect:

     block → block     a connector that re-routes when you move either block
     block → empty     a callout leader pointing at nothing in particular
     empty → empty     a plain arrow you drew, like any other annotation

   Everything else — style, heads, colour, label — is presentation.
   =========================================================================== */
App.arrows = (() => {
  const U = App.util;
  const store = App.store;

  const STYLES = ['curve', 'straight', 'elbow'];
  const HEADS = [
    { id: 'end',  label: '→' },
    { id: 'both', label: '↔' },
    { id: 'start', label: '←' },
    { id: 'none', label: '—' },
  ];

  const DEFAULT_COLOR = 'var(--text-mute)';

  /* An end pinned to a block can either float — sliding around the border to
     face the other end — or be **mounted** to one of nine fixed spots. A mounted
     end stays welded to that corner, so moving the block drags that side of the
     arrow with it. */
  const ANCHORS = {
    nw: [0, 0],   n: [0.5, 0],   ne: [1, 0],
    w:  [0, 0.5], c: [0.5, 0.5], e:  [1, 0.5],
    sw: [0, 1],   s: [0.5, 1],   se: [1, 1],
  };
  const PERIMETER = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  function anchorPoint(node, key) {
    const a = ANCHORS[key];
    if (!a) return null;
    return { x: node.x + node.w * a[0], y: node.y + node.h * a[1] };
  }

  /** All the mounting points on a block, for drawing the handles. */
  const anchorsOf = (node) => PERIMETER.map(k => ({ key: k, ...anchorPoint(node, k) }));

  /** The mount nearest a world point, or null to leave the end floating. */
  function nearestAnchor(node, w, tol) {
    let best = null;
    for (const a of anchorsOf(node)) {
      const d = Math.hypot(a.x - w.x, a.y - w.y);
      if (d <= tol && (!best || d < best.d)) best = { key: a.key, d };
    }
    return best && best.key;
  }

  function make(a, b) {
    return {
      id: U.uid('e'),
      from: a.node || null, fromPt: a.node ? null : { x: Math.round(a.x), y: Math.round(a.y) },
      fromAnchor: a.node ? (a.anchor || null) : null,
      to: b.node || null,   toPt: b.node ? null : { x: Math.round(b.x), y: Math.round(b.y) },
      toAnchor: b.node ? (b.anchor || null) : null,
      label: '', style: 'curve', heads: 'end', color: null,
    };
  }

  /** Where each end actually sits right now. Null if a pinned block is gone. */
  function ends(e) {
    const a = e.from ? store.nodeById(e.from) : null;
    const b = e.to ? store.nodeById(e.to) : null;
    if (e.from && !a) return null;
    if (e.to && !b) return null;

    const ca = a ? { x: a.x + a.w / 2, y: a.y + a.h / 2 } : e.fromPt;
    const cb = b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : e.toPt;
    if (!ca || !cb) return null;

    // a mounted end sits exactly on its anchor; a floating one meets the border
    const p1 = a
      ? (e.fromAnchor ? anchorPoint(a, e.fromAnchor) : App.canvas.borderPoint(a, cb))
      : { ...e.fromPt };
    const p2 = b
      ? (e.toAnchor ? anchorPoint(b, e.toAnchor) : App.canvas.borderPoint(b, ca))
      : { ...e.toPt };
    return { p1, p2, a, b };
  }

  /** The drawn path, as a list of points (used for both the `d` and hit-testing). */
  function points(e, steps = 22) {
    const g = ends(e);
    if (!g) return null;
    const { p1, p2 } = g;

    if (e.style === 'straight') return [p1, p2];

    if (e.style === 'elbow') {
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        const mx = p1.x + dx / 2;
        return [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
      }
      const my = p1.y + dy / 2;
      return [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
    }

    // curve: cubic with control points pulled along the dominant axis
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const k = Math.min(160, Math.max(40, (horiz ? Math.abs(dx) : Math.abs(dy)) / 2));
    const c1 = horiz ? { x: p1.x + Math.sign(dx || 1) * k, y: p1.y } : { x: p1.x, y: p1.y + Math.sign(dy || 1) * k };
    const c2 = horiz ? { x: p2.x - Math.sign(dx || 1) * k, y: p2.y } : { x: p2.x, y: p2.y - Math.sign(dy || 1) * k };
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      out.push({
        x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
        y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
      });
    }
    return out;
  }

  const d = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'} ${U.r(p.x)} ${U.r(p.y)}`).join(' ');

  /** Arrowhead polygon at `tip`, pointing along the direction it arrives from. */
  function head(tip, from, color) {
    const dx = tip.x - from.x, dy = tip.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    // 11 x 4.2 screen pixels, converted into world units for the current zoom,
    // so a head stays the same size on screen however far you zoom out.
    const z = (store.doc() && store.doc().camera.z) || 1;
    // …but never longer than a third of the arrow, so short hops keep a shaft.
    const L = Math.min(9 / z, len * 0.33), W = L * 0.36;
    const b1 = { x: tip.x - ux * L - uy * W, y: tip.y - uy * L + ux * W };
    const b2 = { x: tip.x - ux * L + uy * W, y: tip.y - uy * L - ux * W };
    return `<polygon points="${U.r(tip.x)},${U.r(tip.y)} ${U.r(b1.x)},${U.r(b1.y)} ${U.r(b2.x)},${U.r(b2.y)}"
            fill="${color}"/>`;
  }

  function render(doc) {
    const parts = [];
    let box = null;
    const grow = (p) => {
      if (!box) box = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      box.x1 = Math.min(box.x1, p.x); box.y1 = Math.min(box.y1, p.y);
      box.x2 = Math.max(box.x2, p.x); box.y2 = Math.max(box.y2, p.y);
    };

    for (const e of doc.edges) {
      const pts = points(e);
      if (!pts) continue;
      pts.forEach(grow);

      const sel = store.state.selectedEdge === e.id;
      const color = sel ? 'var(--accent)' : (e.color || DEFAULT_COLOR);
      const path = d(pts);

      parts.push(`<path class="edge-hit" d="${path}" data-edge="${e.id}"/>`);
      // stroke goes inline: the .edge-path class sets a colour too, and a CSS
      // declaration beats a presentation attribute — which is why a coloured
      // arrow used to come out grey with only its head in colour.
      parts.push(`<path class="edge-path${sel ? ' sel' : ''}" d="${path}" data-edge="${e.id}"
                        style="--ew:${e.weight == null ? 1 : e.weight};stroke:${color}"/>`);

      const heads = e.heads || 'end';
      if (heads === 'end' || heads === 'both') {
        parts.push(head(pts[pts.length - 1], pts[pts.length - 2], color));
      }
      if (heads === 'start' || heads === 'both') {
        parts.push(head(pts[0], pts[1], color));
      }
      if (e.label) {
        const m = pts[Math.floor(pts.length / 2)];
        parts.push(`<text class="edge-label" x="${U.r(m.x)}" y="${U.r(m.y - 7)}"
                          text-anchor="middle">${U.esc(e.label)}</text>`);
      }
    }
    return { parts, box };
  }

  /** Nearest arrow to a world point, or null. */
  function hit(w, tol) {
    let best = null;
    for (const e of store.doc().edges) {
      const pts = points(e, 26);
      if (!pts) continue;
      for (let i = 1; i < pts.length; i++) {
        const dist = U.distToSegment(w.x, w.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
        if (dist <= tol && (!best || dist < best.d)) best = { edge: e, d: dist };
      }
    }
    return best && best.edge;
  }

  const selected = () => store.doc().edges.find(e => e.id === store.state.selectedEdge) || null;

  /** Re-point one end of an arrow, pinning it to a block or leaving it free. */
  function setEnd(e, which, target) {
    if (which === 0) {
      e.from = target.node || null;
      e.fromPt = target.node ? null : { x: Math.round(target.x), y: Math.round(target.y) };
      e.fromAnchor = target.node ? (target.anchor || null) : null;
    } else {
      e.to = target.node || null;
      e.toPt = target.node ? null : { x: Math.round(target.x), y: Math.round(target.y) };
      e.toAnchor = target.node ? (target.anchor || null) : null;
    }
  }

  function move(e, dx, dy) {
    if (e.fromPt) { e.fromPt.x += dx; e.fromPt.y += dy; }
    if (e.toPt) { e.toPt.x += dx; e.toPt.y += dy; }
  }

  /** The options strip shown while the arrow tool is active. */
  function renderOptions(el) {
    const p = store.state.arrowPrefs || (store.state.arrowPrefs = { style: 'curve', heads: 'end' });
    el.innerHTML = `
      <div class="units-panel">
        <div class="units-row">
          <span class="units-label">Shape</span>
          ${STYLES.map(s => `<button class="unit-btn${p.style === s ? ' on' : ''}"
            data-astyle="${s}">${s}</button>`).join('')}
          <span class="units-label" style="margin-left:10px">Ends</span>
          ${HEADS.map(h => `<button class="unit-btn${p.heads === h.id ? ' on' : ''}"
            data-aheads="${h.id}">${h.label}</button>`).join('')}
        </div>
        <div class="units-hint">
          Drag from one block to another to connect them — the arrow follows when
          you move either. Drag on empty canvas for a loose arrow. Or click a
          block, then click the next one.
        </div>
      </div>`;
    el.querySelectorAll('[data-astyle]').forEach(b => b.addEventListener('click', () => {
      p.style = b.dataset.astyle; renderOptions(el); applyPrefsToSelection();
    }));
    el.querySelectorAll('[data-aheads]').forEach(b => b.addEventListener('click', () => {
      p.heads = b.dataset.aheads; renderOptions(el); applyPrefsToSelection();
    }));
  }

  function applyPrefsToSelection() {
    const e = selected();
    if (!e) return;
    const p = store.state.arrowPrefs;
    store.beginChange('arrow');
    e.style = p.style; e.heads = p.heads;
    store.commit({ full: true });
  }

  return { make, ends, points, render, hit, selected, setEnd, move,
           renderOptions, STYLES, HEADS, d,
           ANCHORS, PERIMETER, anchorPoint, anchorsOf, nearestAnchor };
})();
