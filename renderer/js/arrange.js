'use strict';
/* ===========================================================================
   arrange.js — sections (FigJam frames / JSON Canvas groups) and the
   align / distribute / tidy commands.

   The most-repeated complaint about Obsidian Canvas is that there's no way to
   move a cluster as one thing. A section owns whatever sits inside it: drag
   the section and its contents come along.
   =========================================================================== */
App.groups = (() => {
  const U = App.util;
  const store = App.store;

  const centre = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

  /** Nodes visually inside a section: blocks by their centre, and a nested
   *  section only when its whole frame fits — otherwise two sections that
   *  merely overlap would each claim the other and dragging would recurse. */
  function childrenOf(group) {
    return store.doc().nodes.filter(n => {
      if (n.id === group.id) return false;
      if (n.type === 'group') {
        return n.x >= group.x && n.y >= group.y &&
               n.x + n.w <= group.x + group.w && n.y + n.h <= group.y + group.h;
      }
      const c = centre(n);
      return c.x >= group.x && c.x <= group.x + group.w &&
             c.y >= group.y && c.y <= group.y + group.h;
    });
  }

  /** Every node that should move when `ids` are dragged, sections expanded. */
  function withChildren(ids) {
    const out = new Map();
    const walk = (n) => {
      if (!n || out.has(n.id)) return;
      out.set(n.id, n);
      if (n.type === 'group') for (const c of childrenOf(n)) walk(c);   // sections nest
    };
    for (const id of ids) walk(store.nodeById(id));
    return [...out.values()];
  }

  /** Wrap the current selection in a new section. */
  function wrapSelection() {
    const sel = store.selectedNodes();
    if (!sel.length) return;
    const b = U.bbox(sel);
    const pad = 34;
    const g = App.nodes.create('group', b.x - pad, b.y - pad - 12, {
      w: b.w + pad * 2, h: b.h + pad * 2 + 12,
      label: 'Section',
    });
    store.addNode(g);
  }

  return { childrenOf, withChildren, wrapSelection };
})();

App.arrange = (() => {
  const U = App.util;
  const store = App.store;

  function targets() {
    return store.selectedNodes().filter(n => n.w > 0 && n.h > 0);
  }

  function align(how) {
    const sel = targets();
    if (sel.length < 2) return;
    const b = U.bbox(sel);
    store.beginChange('align');
    for (const n of sel) {
      if (how === 'left')   n.x = b.x;
      if (how === 'right')  n.x = b.x + b.w - n.w;
      if (how === 'centre') n.x = b.x + (b.w - n.w) / 2;
      if (how === 'top')    n.y = b.y;
      if (how === 'bottom') n.y = b.y + b.h - n.h;
      if (how === 'middle') n.y = b.y + (b.h - n.h) / 2;
      n.x = Math.round(n.x); n.y = Math.round(n.y);
    }
    store.commit({ full: true });
  }

  /** Even gaps between edges, keeping the outermost two anchored. */
  function distribute(axis) {
    const sel = targets();
    if (sel.length < 3) return;
    const horiz = axis === 'h';
    const key = horiz ? 'x' : 'y';
    const size = horiz ? 'w' : 'h';
    const sorted = [...sel].sort((a, b) => a[key] - b[key]);
    const first = sorted[0], last = sorted[sorted.length - 1];
    const span = (last[key] + last[size]) - first[key];
    const used = sorted.reduce((s, n) => s + n[size], 0);
    const gap = (span - used) / (sorted.length - 1);
    store.beginChange('distribute');
    let cursor = first[key];
    for (const n of sorted) { n[key] = Math.round(cursor); cursor += n[size] + gap; }
    store.commit({ full: true });
  }

  /** Reflow the selection into a tidy grid — the answer to "I don't want to
   *  fiddle with layout". Keeps reading order (top-to-bottom, left-to-right). */
  function tidy() {
    const sel = targets();
    if (sel.length < 2) return;
    const b = U.bbox(sel);
    const sorted = [...sel].sort((a, b2) => (a.y - b2.y) || (a.x - b2.x));
    const cols = Math.max(1, Math.round(Math.sqrt(sorted.length)));
    const gap = 28;
    const colW = Math.max(...sorted.map(n => n.w));
    store.beginChange('tidy');
    let x = b.x, y = b.y, rowH = 0, i = 0;
    for (const n of sorted) {
      n.x = Math.round(x); n.y = Math.round(y);
      rowH = Math.max(rowH, n.h);
      x += colW + gap;
      if (++i % cols === 0) { x = b.x; y += rowH + gap; rowH = 0; }
    }
    store.commit({ full: true });
  }

  // ── snapping guides ─────────────────────────────────────────────────────
  /** While dragging, find edges/centres of other nodes worth snapping to.
   *  Returns {dx, dy, guides:[{axis,at,from,to}]} in world units. */
  function snap(moving, others, threshold) {
    const b = U.bbox(moving);
    if (!b) return { dx: 0, dy: 0, guides: [] };

    const vx = [b.x, b.x + b.w / 2, b.x + b.w];
    const vy = [b.y, b.y + b.h / 2, b.y + b.h];
    let best = { x: null, y: null };

    for (const o of others) {
      if (o.w <= 0) continue;
      const ox = [o.x, o.x + o.w / 2, o.x + o.w];
      const oy = [o.y, o.y + o.h / 2, o.y + o.h];
      for (const a of vx) for (const t of ox) {
        const d = t - a;
        if (Math.abs(d) <= threshold && (!best.x || Math.abs(d) < Math.abs(best.x.d))) {
          best.x = { d, at: t, o };
        }
      }
      for (const a of vy) for (const t of oy) {
        const d = t - a;
        if (Math.abs(d) <= threshold && (!best.y || Math.abs(d) < Math.abs(best.y.d))) {
          best.y = { d, at: t, o };
        }
      }
    }

    const guides = [];
    if (best.x) guides.push({
      axis: 'v', at: best.x.at,
      from: Math.min(b.y, best.x.o.y), to: Math.max(b.y + b.h, best.x.o.y + best.x.o.h),
    });
    if (best.y) guides.push({
      axis: 'h', at: best.y.at,
      from: Math.min(b.x, best.y.o.x), to: Math.max(b.x + b.w, best.y.o.x + best.y.o.w),
    });
    return { dx: best.x ? best.x.d : 0, dy: best.y ? best.y.d : 0, guides };
  }

  return { align, distribute, tidy, snap };
})();
