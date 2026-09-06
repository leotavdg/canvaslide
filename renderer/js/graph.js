'use strict';
/* ===========================================================================
   graph.js — the vault as a graph of pages.

   Obsidian's graph is the feature people point at when they describe the
   "shape" of what they know. A plain force-directed layout: repulsion between
   every pair, springs along links, mild gravity, cooling. Small vaults settle
   in well under a second, so it runs on rAF and stops when it's calm.
   =========================================================================== */
App.graph = (() => {
  const U = App.util;
  const store = App.store;

  let box, svg, hint;
  let nodes = [], links = [], raf = null, alpha = 0;
  let view = { x: 0, y: 0, z: 1 };
  let drag = null, hover = null;
  let localOnly = false;

  const norm = (s) => String(s || '').trim().toLowerCase();

  function build() {
    const docs = store.indexDocs();
    const byName = new Map(docs.map(d => [norm(d.name), d]));
    const current = store.doc();

    const edgeSet = [];
    for (const d of docs) {
      for (const n of (d.nodes || [])) {
        const txt = store.nodeText(n);
        for (const l of App.md.links(txt)) {
          const t = byName.get(norm(l));
          if (t && t.id !== d.id) edgeSet.push([d.id, t.id]);
        }
      }
    }

    let keep = docs;
    if (localOnly && current) {
      // one hop out from the page you're on
      const near = new Set([current.id]);
      for (const [a, b] of edgeSet) {
        if (a === current.id) near.add(b);
        if (b === current.id) near.add(a);
      }
      keep = docs.filter(d => near.has(d.id));
    }
    const keepIds = new Set(keep.map(d => d.id));

    const degree = new Map();
    for (const [a, b] of edgeSet) {
      if (!keepIds.has(a) || !keepIds.has(b)) continue;
      degree.set(a, (degree.get(a) || 0) + 1);
      degree.set(b, (degree.get(b) || 0) + 1);
    }

    const r = box.getBoundingClientRect();
    const cx = r.width / 2, cy = (r.height / 2) - 20;
    const prev = new Map(nodes.map(n => [n.id, n]));

    nodes = keep.map((d, i) => {
      const old = prev.get(d.id);
      const ang = (i / Math.max(1, keep.length)) * Math.PI * 2;
      const rad = 80 + Math.min(260, keep.length * 9);
      return {
        id: d.id,
        name: d.name,
        deg: degree.get(d.id) || 0,
        x: old ? old.x : cx + Math.cos(ang) * rad,
        y: old ? old.y : cy + Math.sin(ang) * rad,
        vx: 0, vy: 0,
        current: current && d.id === current.id,
      };
    });

    const index = new Map(nodes.map(n => [n.id, n]));
    const seen = new Set();
    links = [];
    for (const [a, b] of edgeSet) {
      const key = a < b ? a + b : b + a;
      if (!index.has(a) || !index.has(b) || seen.has(key)) continue;
      seen.add(key);
      links.push({ a: index.get(a), b: index.get(b) });
    }
    alpha = 1;
  }

  function step() {
    const r = box.getBoundingClientRect();
    const cx = r.width / 2, cy = (r.height / 2) - 20;
    const REPEL = 5200, SPRING = 0.012, REST = 128, GRAVITY = 0.014;

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1; }
        const d = Math.sqrt(d2);
        const f = REPEL / d2;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
    for (const l of links) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - REST) * SPRING;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      l.a.vx += fx; l.a.vy += fy;
      l.b.vx -= fx; l.b.vy -= fy;
    }
    for (const n of nodes) {
      n.vx += (cx - n.x) * GRAVITY;
      n.vy += (cy - n.y) * GRAVITY;
      if (drag && drag.node === n) continue;
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx * alpha;
      n.y += n.vy * alpha;
    }
    alpha *= 0.985;
  }

  const radiusOf = (n) => 6 + Math.min(13, n.deg * 1.9);

  function draw() {
    const parts = [];
    for (const l of links) {
      const lit = hover && (l.a.id === hover || l.b.id === hover);
      parts.push(`<line x1="${l.a.x}" y1="${l.a.y}" x2="${l.b.x}" y2="${l.b.y}"
        stroke="${lit ? 'var(--accent)' : 'var(--line)'}" stroke-width="${lit ? 1.8 : 1}"/>`);
    }
    for (const n of nodes) {
      const r = radiusOf(n);
      const lit = hover === n.id;
      const fill = n.current ? 'var(--accent)' : (n.deg ? 'var(--accent-2)' : 'var(--text-mute)');
      parts.push(`<circle class="g-node" data-id="${n.id}" cx="${n.x}" cy="${n.y}" r="${r}"
        fill="${fill}" opacity="${lit || n.current ? 1 : 0.82}"
        stroke="${lit ? 'var(--text)' : 'transparent'}" stroke-width="2" style="cursor:pointer"/>`);
      if (n.deg > 0 || n.current || lit || nodes.length < 26) {
        parts.push(`<text class="g-label" x="${n.x}" y="${n.y + r + 13}" text-anchor="middle"
          opacity="${lit || n.current ? 1 : 0.66}">${U.esc(n.name.slice(0, 26))}</text>`);
      }
    }
    svg.innerHTML = `<g transform="translate(${view.x},${view.y}) scale(${view.z})">${parts.join('')}</g>`;
    hint.textContent = `${nodes.length} page${nodes.length === 1 ? '' : 's'} · ${links.length} link${links.length === 1 ? '' : 's'}`;
  }

  function tick() {
    if (alpha > 0.004) step();
    draw();
    raf = requestAnimationFrame(tick);
  }

  // ── interaction ─────────────────────────────────────────────────────────
  function toLocal(e) {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.z, y: (e.clientY - r.top - view.y) / view.z };
  }
  function nodeAt(p) {
    let best = null;
    for (const n of nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d <= radiusOf(n) + 6 && (!best || d < best.d)) best = { n, d };
    }
    return best && best.n;
  }

  function wire() {
    svg.addEventListener('pointerdown', (e) => {
      const p = toLocal(e);
      const n = nodeAt(p);
      drag = n ? { node: n, dx: n.x - p.x, dy: n.y - p.y, moved: false }
               : { pan: true, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      const p = toLocal(e);
      const over = nodeAt(p);
      const id = over ? over.id : null;
      if (id !== hover) { hover = id; svg.style.cursor = id ? 'pointer' : 'grab'; }
      if (!drag) return;
      drag.moved = true;
      if (drag.pan) {
        view.x = drag.vx + (e.clientX - drag.sx);
        view.y = drag.vy + (e.clientY - drag.sy);
      } else {
        drag.node.x = p.x + drag.dx;
        drag.node.y = p.y + drag.dy;
        drag.node.vx = drag.node.vy = 0;
        alpha = Math.max(alpha, 0.28);
      }
    });
    svg.addEventListener('pointerup', async (e) => {
      const d = drag;
      drag = null;
      try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
      if (d && d.node && !d.moved) {
        close();
        await store.openPage(d.node.id);
      }
    });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.0016);
      const z2 = U.clamp(view.z * f, 0.2, 4);
      view.x = mx - (mx - view.x) * (z2 / view.z);
      view.y = my - (my - view.y) * (z2 / view.z);
      view.z = z2;
    }, { passive: false });
  }

  // ── open / close ────────────────────────────────────────────────────────
  function open() {
    box.classList.remove('hidden');
    view = { x: 0, y: 0, z: 1 };
    build();
    if (!raf) tick();
  }
  function close() {
    box.classList.add('hidden');
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }
  const isOpen = () => !box.classList.contains('hidden');
  function toggle() { isOpen() ? close() : open(); }

  function mount() {
    box = document.getElementById('graph');
    svg = document.getElementById('graph-svg');
    hint = document.getElementById('graph-hint');
    wire();
    document.getElementById('graph-close').addEventListener('click', close);
    const localBtn = document.getElementById('graph-local');
    localBtn.addEventListener('click', () => {
      localOnly = !localOnly;
      localBtn.classList.toggle('primary', localOnly);
      localBtn.textContent = localOnly ? 'Local graph' : 'Whole vault';
      build();
    });
    box.addEventListener('pointerdown', (e) => { if (e.target === box) close(); });
  }

  return { mount, open, close, toggle, isOpen };
})();
