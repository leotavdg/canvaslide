'use strict';
/* ===========================================================================
   canvas.js — the viewport: camera, painting, and every pointer gesture.

   Coordinate systems
     world  — what nodes store. Infinite, origin arbitrary.
     screen — pixels inside #viewport.
   world → screen : s = w * z + cam ;  screen → world : w = (s - cam) / z
   =========================================================================== */
App.canvas = (() => {
  const U = App.util;
  const store = App.store;
  const NODES = App.nodes;

  let viewport, world, layerNodes, layerPins, edgeSvg, overlay, emptyHint;

  // Live gesture state. `mode` is null when idle.
  const g = {
    mode: null,        // pan | drag | resize | marquee | ink | erase | connect
    startS: null,      // pointer-down, screen
    startW: null,      // pointer-down, world
    lastS: null,
    origin: null,      // per-mode scratch
    spaceDown: false,
    inkPts: null,
    connectFrom: null,
    marquee: null,
    moved: false,
  };

  const cam = () => store.doc().camera;

  // ── coordinate helpers ──────────────────────────────────────────────────
  function screenOf(e) {
    const r = viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function toWorld(s) {
    const c = cam();
    return { x: (s.x - c.x) / c.z, y: (s.y - c.y) / c.z };
  }
  function toScreen(w) {
    const c = cam();
    return { x: w.x * c.z + c.x, y: w.y * c.z + c.y };
  }

  // The minimap and outline listen on doc-changed, but dragging and panning use
  // the cheap repaint paths that never emit it — so nudge them here, coalesced
  // into one redraw per frame.
  // Throttled by clock rather than rAF on purpose: requestAnimationFrame is
  // throttled hard when the window isn't focused, which made the minimap look
  // frozen until you let go of the mouse.
  let panelsAt = 0, panelsTimer = null;
  function panelsSoon() {
    if (!App.panels) return;
    const now = performance.now();
    if (now - panelsAt >= 32) {
      panelsAt = now;
      App.panels.drawMinimap();
      return;
    }
    if (panelsTimer) return;
    panelsTimer = setTimeout(() => {
      panelsTimer = null;
      panelsAt = performance.now();
      App.panels.drawMinimap();
    }, 32);
  }

  function applyCamera() {
    const c = cam();
    world.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.z})`;
    // Everything that must stay legible at any zoom reads --z in CSS.
    world.style.setProperty('--z', c.z);
    const label = document.getElementById('zoom-label');
    if (label) label.textContent = Math.round(c.z * 100) + '%';
    paintGrid(c);
    panelsSoon();
  }

  /** The background grid moves and scales with the camera, so it means
   *  something: in drafting mode each square is a real 10 units. */
  function paintGrid(c) {
    const drafting = document.getElementById('app').classList.contains('drafting');
    const minor = 10 * c.z;                    // 10 canvas px per small square
    const ox = c.x % (minor * 5), oy = c.y % (minor * 5);

    if (!drafting) {
      const step = 26 * c.z;
      viewport.style.backgroundImage = 'radial-gradient(var(--grid) 1px, transparent 1px)';
      viewport.style.backgroundSize = `${step}px ${step}px`;
      viewport.style.backgroundPosition = `${c.x % step}px ${c.y % step}px`;
      return;
    }
    if (minor < 3) {                           // too dense to read: drop it
      viewport.style.backgroundImage = 'none';
      return;
    }
    const maj = minor * 5;
    viewport.style.backgroundImage =
      'linear-gradient(var(--grid) 1px, transparent 1px),' +
      'linear-gradient(90deg, var(--grid) 1px, transparent 1px),' +
      'linear-gradient(var(--grid-major, rgba(0,0,0,.10)) 1px, transparent 1px),' +
      'linear-gradient(90deg, var(--grid-major, rgba(0,0,0,.10)) 1px, transparent 1px)';
    viewport.style.backgroundSize =
      `${minor}px ${minor}px, ${minor}px ${minor}px, ${maj}px ${maj}px, ${maj}px ${maj}px`;
    viewport.style.backgroundPosition =
      `${c.x % minor}px ${c.y % minor}px, ${c.x % minor}px ${c.y % minor}px, ${ox}px ${oy}px, ${ox}px ${oy}px`;
  }

  // ── painting ────────────────────────────────────────────────────────────
  function render() {
    const d = store.doc();
    if (!d) return;
    applyCamera();

    const seen = new Set();
    for (const n of d.nodes) {
      seen.add(n.id);
      const el = NODES.ensureEl(n, layerNodes);
      NODES.paint(n, el);
    }
    for (const el of [...layerNodes.children]) {
      if (!seen.has(el.dataset.id)) el.remove();
    }

    renderEdges(d);
    App.comments.renderPins(d);
    renderOverlay();
    emptyHint.classList.toggle('hidden', d.nodes.length > 0 || d.comments.length > 0);
  }

  /** Where a line from `from` toward `to` leaves node `n`'s box. */
  function borderPoint(n, toward) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const dx = toward.x - cx, dy = toward.y - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const sx = dx ? (n.w / 2) / Math.abs(dx) : Infinity;
    const sy = dy ? (n.h / 2) / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  function renderEdges(d) {
    const { parts, box } = App.arrows.render(d);
    // Fit the SVG box to the arrows themselves. Without this the element keeps
    // its intrinsic 300x150 and anything drawn outside is unclickable.
    if (box) {
      const pad = 60;
      const x = box.x1 - pad, y = box.y1 - pad;
      const w = Math.max(1, box.x2 - box.x1 + pad * 2);
      const h = Math.max(1, box.y2 - box.y1 + pad * 2);
      edgeSvg.style.left = x + 'px';
      edgeSvg.style.top = y + 'px';
      edgeSvg.style.width = w + 'px';
      edgeSvg.style.height = h + 'px';
      edgeSvg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    }
    edgeSvg.innerHTML = parts.join('');
  }

  /** Screen-space chrome: handles, ports, marquee, live ink, connector rubber-band. */
  function renderOverlay() {
    const parts = [];
    const sel = store.selectedNodes();

    if (store.state.tool === 'select' && sel.length === 1 && sel[0].type === 'dim' && !g.mode) {
      const n = sel[0];
      const G = App.cad.dimGeometry(n);
      const A = toScreen({ x: G.a[0], y: G.a[1] });
      const B = toScreen({ x: G.b[0], y: G.b[1] });
      const M = toScreen({ x: (G.q1[0] + G.q2[0]) / 2, y: (G.q1[1] + G.q2[1]) / 2 });
      for (const [k, p] of [['0', A], ['1', B]]) {
        parts.push(`<circle data-dimpt="${k}" cx="${p.x}" cy="${p.y}" r="6"
          fill="var(--bg)" stroke="var(--accent)" stroke-width="2"
          style="pointer-events:all;cursor:crosshair"/>`);
      }
      parts.push(`<rect data-dimoff="1" x="${M.x - 5}" y="${M.y - 5}" width="10" height="10" rx="5"
        fill="var(--accent)" stroke="var(--bg)" stroke-width="1.5"
        style="pointer-events:all;cursor:move"/>`);
    }
    else if (store.state.tool === 'select' && (!g.mode || g.mode === 'resize')
             && (sel.length > 1
                 ? sel.some(s2 => s2.w > 0 && s2.type !== 'dim')
                 : sel.length === 1 && sel[0].type !== 'dim')) {
      // One block resizes itself; several resize as a group, each scaled by
      // the same factors about the box you're dragging.
      const n = sel.length === 1 ? sel[0] : U.bbox(sel.filter(s2 => s2.w > 0));
      const tl = toScreen({ x: n.x, y: n.y });
      const br = toScreen({ x: n.x + n.w, y: n.y + n.h });
      const w = br.x - tl.x, h = br.y - tl.y;

      // Invisible grab bands: the whole edge resizes, not just a midpoint, and
      // nothing about the block's appearance changes. The cursor is the only
      // affordance — which is the point.
      const BAND = 9;                    // how far either side of the edge counts
      const c = Math.min(16, Math.max(6, Math.min(w, h) / 3));   // corner zone
      const band = (k, x, y, bw, bh, cur) =>
        parts.push(`<rect data-handle="${k}" x="${x}" y="${y}" width="${Math.max(0, bw)}"
          height="${Math.max(0, bh)}" fill="transparent"
          style="pointer-events:all;cursor:${cur}"/>`);

      // edges first, corners painted over them so corners win the overlap
      band('n', tl.x + c, tl.y - BAND, w - c * 2, BAND * 2, 'ns-resize');
      band('s', tl.x + c, br.y - BAND, w - c * 2, BAND * 2, 'ns-resize');
      band('w', tl.x - BAND, tl.y + c, BAND * 2, h - c * 2, 'ew-resize');
      band('e', br.x - BAND, tl.y + c, BAND * 2, h - c * 2, 'ew-resize');
      band('nw', tl.x - BAND, tl.y - BAND, c + BAND, c + BAND, 'nwse-resize');
      band('ne', br.x - c,    tl.y - BAND, c + BAND, c + BAND, 'nesw-resize');
      band('sw', tl.x - BAND, br.y - c,    c + BAND, c + BAND, 'nesw-resize');
      band('se', br.x - c,    br.y - c,    c + BAND, c + BAND, 'nwse-resize');

      if (g.mode === 'resize') {
        const txt = `${App.cad.measure(n.w)} × ${App.cad.measure(n.h)}`;
        // size the pill to the text — "1000 mm × 500 mm" does not fit in 92px
        const bw = txt.length * 6.7 + 16;
        const cx = (tl.x + br.x) / 2;
        parts.push(`<rect x="${cx - bw / 2}" y="${br.y + 10}" width="${bw}" height="21" rx="5"
          fill="var(--panel-2)" stroke="var(--line)"/>`);
        parts.push(`<text x="${cx}" y="${br.y + 24.5}" text-anchor="middle"
          fill="var(--text)" font-size="11" font-family="var(--mono)">${U.esc(txt)}</text>`);
      }
    }

    // Connector ports belong to the connector tool now, so a plain selection
    // shows no dots at all.
    if (store.state.tool === 'connect' && !g.mode) {
      const r = viewport.getBoundingClientRect();
      for (const n of store.doc().nodes) {
        if (n.type === 'ink' || n.type === 'dim' || n.w <= 0) continue;
        for (const a of App.arrows.anchorsOf(n)) {
          const p = toScreen(a);
          if (p.x < -10 || p.y < -10 || p.x > r.width + 10 || p.y > r.height + 10) continue;
          parts.push(`<circle class="ov-port" data-port="${a.key}" data-portnode="${n.id}"
            cx="${p.x}" cy="${p.y}" r="4.5" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"
            opacity="0.75" style="pointer-events:all;cursor:crosshair"/>`);
        }
      }
    }

    // Multi-selection still needs *something*, but it's one box around the lot
    // rather than an outline redrawn on every block.
    if (sel.length > 1 && !g.mode) {
      const b = U.bbox(sel);
      if (b) {
        const tl = toScreen({ x: b.x, y: b.y });
        const br = toScreen({ x: b.x + b.w, y: b.y + b.h });
        parts.push(`<rect class="multi-box" x="${tl.x - 4}" y="${tl.y - 4}"
          width="${br.x - tl.x + 8}" height="${br.y - tl.y + 8}" rx="4"/>`);
      }
    }

    if (g.guides && g.guides.length) {
      for (const gu of g.guides) {
        const a = toScreen(gu.axis === 'v' ? { x: gu.at, y: gu.from } : { x: gu.from, y: gu.at });
        const b = toScreen(gu.axis === 'v' ? { x: gu.at, y: gu.to } : { x: gu.to, y: gu.at });
        parts.push(`<line class="snap-guide" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
      }
    }

    if (g.marquee) {
      const m = g.marquee;
      parts.push(`<rect class="marquee" x="${Math.min(m.x1, m.x2)}" y="${Math.min(m.y1, m.y2)}"
        width="${Math.abs(m.x2 - m.x1)}" height="${Math.abs(m.y2 - m.y1)}"/>`);
    }

    if (g.mode === 'ink' && g.inkPts && g.inkPts.length > 1) {
      const pen = store.state.pen;
      const scr = g.inkPts.map(p => { const s = toScreen({ x: p[0], y: p[1] }); return [s.x, s.y]; });
      parts.push(`<path class="ink-preview" d="${U.strokePath(scr)}" stroke="${pen.color}"
        stroke-width="${pen.size * cam().z}"/>`);
    }

    if (g.mode === 'dim' && g.dimA) {
      const A = toScreen(g.dimA);
      const B = toScreen(g.dimB || g.dimA);
      parts.push(`<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"
        stroke="var(--accent)" stroke-width="1.4" stroke-dasharray="5 4"/>`);
      for (const p of [A, B]) {
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--accent)"/>`);
      }
      const px = Math.hypot((g.dimB || g.dimA).x - g.dimA.x, (g.dimB || g.dimA).y - g.dimA.y);
      parts.push(`<rect x="${(A.x + B.x) / 2 - 44}" y="${(A.y + B.y) / 2 - 26}" width="88" height="20" rx="5"
        fill="var(--panel-2)" stroke="var(--line)"/>`);
      parts.push(`<text x="${(A.x + B.x) / 2}" y="${(A.y + B.y) / 2 - 12}" text-anchor="middle"
        fill="var(--text)" font-size="11" font-family="var(--mono)">${App.cad.measure(px)}</text>`);
    }

    if (g.axis && g.startS) {
      const r = viewport.getBoundingClientRect();
      const at = g.mode === 'drag' ? g.startS : toScreen(g.dimA || toWorld(g.startS));
      const line = g.axis === 'h'
        ? `x1="0" y1="${at.y}" x2="${r.width}" y2="${at.y}"`
        : `x1="${at.x}" y1="0" x2="${at.x}" y2="${r.height}"`;
      parts.push(`<line class="axis-guide" ${line}/>`);
    }

    if (g.snapDot) {
      const p = toScreen(g.snapDot);
      parts.push(`<rect x="${p.x - 5}" y="${p.y - 5}" width="10" height="10"
        fill="none" stroke="#ff5c8a" stroke-width="1.6"/>`);
    }

    // rubber band while drawing an arrow (drag, or between the two clicks)
    const drawingFrom = (g.mode === 'connect' && g.connectFrom) ||
                        (g.pendingArrow && g.pendingArrow.start);
    if (drawingFrom && g.lastS) {
      const w = toWorld(g.lastS);
      let p1;
      if (drawingFrom.node) {
        const n = store.nodeById(drawingFrom.node);
        p1 = n ? toScreen(borderPoint(n, w)) : null;
      } else {
        p1 = toScreen(drawingFrom);
      }
      if (p1) {
        parts.push(`<path class="conn-preview" d="M ${p1.x} ${p1.y} L ${g.lastS.x} ${g.lastS.y}"/>`);
        parts.push(`<circle cx="${g.lastS.x}" cy="${g.lastS.y}" r="3.5" fill="var(--accent)"/>`);
      }
    }

    // highlight whatever the arrow would land on, and which mount it would take
    if (g.arrowTarget) {
      const n = store.nodeById(g.arrowTarget);
      if (n) {
        const tl = toScreen({ x: n.x, y: n.y });
        const br = toScreen({ x: n.x + n.w, y: n.y + n.h });
        parts.push(`<rect class="arrow-target" x="${tl.x - 3}" y="${tl.y - 3}"
          width="${br.x - tl.x + 6}" height="${br.y - tl.y + 6}" rx="6"/>`);
        const live = g.lastS ? mountAt(n, toWorld(g.lastS)) : null;
        for (const a of App.arrows.anchorsOf(n)) {
          const p = toScreen(a);
          const on = a.key === live;
          parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${on ? 6 : 3.5}"
            fill="${on ? 'var(--accent)' : 'var(--bg)'}" stroke="var(--accent)"
            stroke-width="${on ? 2 : 1.4}"/>`);
        }
      }
    }

    // a selected arrow gets a grip on each end so it can be re-routed
    if (store.state.selectedEdge && !g.mode) {
      const e2 = App.arrows.selected();
      const g2 = e2 && App.arrows.ends(e2);
      if (g2) {
        for (const [i, p] of [[0, g2.p1], [1, g2.p2]]) {
          const sp = toScreen(p);
          parts.push(`<circle data-arrowend="${i}" cx="${sp.x}" cy="${sp.y}" r="6"
            fill="var(--bg)" stroke="var(--accent)" stroke-width="2"
            style="pointer-events:all;cursor:crosshair"/>`);
        }
      }
    }

    overlay.innerHTML = parts.join('');
  }

  // ── camera ──────────────────────────────────────────────────────────────
  /* A zoom moves the camera, not the document: the nodes' own markup is
     unchanged, so repaint the transform and the screen-space overlay only.
     `will-change: transform` is added for the gesture and dropped 140ms after
     it stops — holding it permanently is what left the layer rasterised at the
     old scale (blurry) until the compositor got round to redrawing it. */
  let gestureTimer = null;
  function gesturing() {
    world.classList.add('gesturing');
    clearTimeout(gestureTimer);
    gestureTimer = setTimeout(() => {
      world.classList.remove('gesturing');
      // nudge the compositor into re-rastering at the final scale, now
      world.style.transform += ' translateZ(0)';
      requestAnimationFrame(applyCamera);
    }, 140);
  }

  function cameraOnly() {
    applyCamera();
    renderOverlay();
    const d = store.doc();
    if (!d) return;
    renderEdges(d);              // arrowheads are sized in screen px
    App.comments.renderPins(d);
  }

  function zoomAt(sx, sy, factor) {
    const c = cam();
    const z2 = U.clamp(c.z * factor, 0.08, 5);
    if (z2 === c.z) return;
    // keep the world point under the cursor pinned
    c.x = sx - (sx - c.x) * (z2 / c.z);
    c.y = sy - (sy - c.y) * (z2 / c.z);
    c.z = z2;
    gesturing();
    cameraOnly();
    store.saveCamera();
  }

  function zoomTo(z) {
    const r = viewport.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, z / cam().z);
  }

  function zoomToFit(pad = 90) {
    const d = store.doc();
    if (!d) return;
    const items = d.nodes.filter(n => n.w > 0 && n.h > 0);
    const box = U.bbox(items.length ? items : [{ x: -300, y: -200, w: 600, h: 400 }]);
    const r = viewport.getBoundingClientRect();
    const z = U.clamp(Math.min((r.width - pad * 2) / box.w, (r.height - pad * 2) / box.h), 0.08, 2);
    const c = cam();
    c.z = z;
    c.x = r.width / 2 - (box.x + box.w / 2) * z;
    c.y = r.height / 2 - (box.y + box.h / 2) * z;
    render();
    store.saveCamera();
  }

  /** Centre the camera on an arbitrary world point (used by minimap/outline). */
  function centerOnPoint(p) {
    const r = viewport.getBoundingClientRect();
    const c = cam();
    c.x = r.width / 2 - p.x * c.z;
    c.y = r.height / 2 - p.y * c.z;
    render();
    store.saveCamera();
  }

  /** Bring a node into view only if it isn't already comfortably visible. */
  function ensureVisible(n) {
    const r = viewport.getBoundingClientRect();
    const tl = toScreen({ x: n.x, y: n.y });
    const br = toScreen({ x: n.x + n.w, y: n.y + n.h });
    const m = 40;
    if (tl.x >= m && tl.y >= m && br.x <= r.width - m && br.y <= r.height - m) return;
    centerOn(n);
  }

  /** Frame just what's selected. */
  function zoomToSelection(pad = 120) {
    const sel = store.selectedNodes().filter(n => n.w > 0);
    if (!sel.length) return zoomToFit();
    const box = U.bbox(sel);
    const r = viewport.getBoundingClientRect();
    const c = cam();
    c.z = U.clamp(Math.min((r.width - pad * 2) / box.w, (r.height - pad * 2) / box.h), 0.08, 2.5);
    c.x = r.width / 2 - (box.x + box.w / 2) * c.z;
    c.y = r.height / 2 - (box.y + box.h / 2) * c.z;
    render();
    store.saveCamera();
  }

  function centerOn(n) {
    const r = viewport.getBoundingClientRect();
    const c = cam();
    c.x = r.width / 2 - (n.x + n.w / 2) * c.z;
    c.y = r.height / 2 - (n.y + n.h / 2) * c.z;
    render();
    store.saveCamera();
  }

  // ── hit testing ─────────────────────────────────────────────────────────
  function nodeElAt(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el ? el.closest('.node') : null;
  }
  /** Loose arrows (both ends unpinned) whose ends both fall inside `nodes`. */
  function looseEdgesWithin(nodes) {
    const boxes = nodes.filter(n => n.w > 0 && n.h > 0);
    if (!boxes.length) return [];
    const b = U.bbox(boxes);
    const inside = (p) => p && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    return store.doc().edges.filter(e => !e.from && !e.to && inside(e.fromPt) && inside(e.toPt));
  }

  function nodeAt(e) {
    const el = nodeElAt(e);
    return el ? store.nodeById(el.dataset.id) : null;
  }

  const edgeSamples = (e, steps) => App.arrows.points(e, steps);
  const edgeAt = (w, tol) => App.arrows.hit(w, tol == null ? 9 / cam().z : tol);

  /** Ink strokes whose polyline passes within `rad` world-units of a point. */
  function inkHits(wp, rad) {
    const hits = [];
    for (const n of store.doc().nodes) {
      if (n.type !== 'ink') continue;
      const lx = wp.x - n.x, ly = wp.y - n.y;
      if (lx < -rad || ly < -rad || lx > n.w + rad || ly > n.h + rad) continue;
      for (let si = 0; si < n.strokes.length; si++) {
        const pts = n.strokes[si].points;
        for (let i = 1; i < pts.length; i++) {
          if (U.distToSegment(lx, ly, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= rad) {
            hits.push({ node: n, index: si });
            si = n.strokes.length; break;
          }
        }
      }
    }
    return hits;
  }

  // ── gestures ────────────────────────────────────────────────────────────
  function onPointerDown(e) {
    if (e.button === 2) return;
    const s = screenOf(e);
    const w = toWorld(s);
    g.startS = s; g.startW = w; g.lastS = s; g.moved = false;
    const tool = store.state.tool;

    // 1. overlay chrome (resize handles / connector ports) wins
    const endTarget = e.target.closest ? e.target.closest('[data-arrowend]') : null;
    if (endTarget) {
      const edge = App.arrows.selected();
      if (edge) {
        g.mode = 'arrowend';
        g.origin = { edge, which: +endTarget.dataset.arrowend, began: false };
        viewport.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    const dimTarget = e.target.closest ? e.target.closest('[data-dimpt],[data-dimoff]') : null;
    if (dimTarget) {
      const n = store.selectedNodes()[0];
      if (n && n.type === 'dim') {
        g.mode = 'dimedit';
        g.origin = {
          node: n, began: false,
          which: dimTarget.dataset.dimpt != null ? +dimTarget.dataset.dimpt : 'off',
        };
        viewport.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    const ovTarget = e.target.closest ? e.target.closest('[data-handle],[data-port]') : null;
    if (ovTarget) {
      const selNow = store.selectedNodes();
      const n = selNow[0];
      if (n && ovTarget.dataset.handle) {
        const many = selNow.filter(s2 => s2.w > 0);
        const box = selNow.length > 1 ? U.bbox(many) : { x: n.x, y: n.y, w: n.w, h: n.h };
        g.mode = 'resize';
        g.origin = {
          corner: ovTarget.dataset.handle, box, node: n, began: false,
          group: selNow.length > 1
            ? many.map(m => ({ id: m.id, x: m.x, y: m.y, w: m.w, h: m.h }))
            : null,
        };
        viewport.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (ovTarget.dataset.port) {
        const id = ovTarget.dataset.portnode || (n && n.id);
        if (!id) return;
        g.mode = 'connect';
        g.connectFrom = { node: id, anchor: ovTarget.dataset.port };
        viewport.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    // 2. panning: middle mouse, space, or hand tool
    if (e.button === 1 || g.spaceDown || tool === 'hand') {
      g.mode = 'pan';
      g.origin = { camX: cam().x, camY: cam().y };
      viewport.classList.add('panning');
      viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // 3. drawing tools
    if (tool === 'pen') {
      g.mode = 'ink';
      g.inkPts = [[w.x, w.y]];
      viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (tool === 'dim') {
      const snap = App.cad.snapPoint(w, 11 / cam().z);
      g.mode = 'dim';
      g.dimA = snap ? { x: snap.p[0], y: snap.p[1] } : w;
      g.dimB = g.dimA;
      viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (tool === 'eraser') {
      g.mode = 'erase';
      store.beginChange('erase');
      eraseAt(w);
      viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // 4. creation tools
    if (['note', 'sticky', 'todo', 'shape', 'table', 'group'].includes(tool)) {
      const def = NODES.DEFAULTS[tool];
      const n = NODES.create(tool, w.x - def.w / 2, w.y - def.h / 2);
      if (tool === 'sticky') n.color = store.state.lastSticky || App.palette.sticky[0];
      store.addNode(n);
      store.setTool('select');
      requestAnimationFrame(() => focusNode(n.id));
      e.preventDefault();
      return;
    }
    if (tool === 'comment') {
      const over = nodeAt(e);
      App.comments.createAt(w, over ? over.id : null);
      store.setTool('select');
      e.preventDefault();
      return;
    }
    if (tool === 'connect') {
      // a second click finishes an arrow started by a previous click
      if (g.pendingArrow) {
        const over = nodeAt(e);
        finishArrow(g.pendingArrow.start, over ? { node: over.id, anchor: mountAt(over, w) } : w);
        g.pendingArrow = null;
        renderOverlay();
        e.preventDefault();
        return;
      }
      const n = nodeAt(e);
      g.mode = 'connect';
      g.connectFrom = n ? { node: n.id } : { x: w.x, y: w.y };
      viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // 5. select tool
    const el = nodeElAt(e);
    const overNode = el ? store.nodeById(el.dataset.id) : null;

    // a press on empty canvas — or on a section's backdrop — may still be
    // aimed at an arrow running underneath
    if (!overNode || overNode.type === 'group') {
      const hitEdge = edgeAt(w);
      if (hitEdge) {
        store.clearSelection();
        store.state.selectedEdge = hitEdge.id;
        store.emit('selection-changed');
        // an arrow with both ends loose is a free object: let it be dragged
        if (!hitEdge.from && !hitEdge.to) {
          g.mode = 'arrowmove';
          g.origin = { edge: hitEdge, began: false, last: w };
          viewport.setPointerCapture(e.pointerId);
        }
        render();
        return;
      }
    }

    if (el) {
      const nodeEl = el;
      const n = store.nodeById(el.dataset.id);
      if (!n) return;
      const editable = e.target.closest && e.target.closest('[contenteditable="true"]');
      const control = e.target.closest && e.target.closest('[data-act]');
      const alreadySelected = store.state.selection.has(n.id);

      if (control) return;                       // checkbox / add-row handle it

      // A text field can cover the whole block (a sticky is nothing but text),
      // so "press on text = edit" would make selected blocks undraggable.
      // Defer instead: a press that never moves places the caret on release,
      // a press that moves is a drag. Once you're actually typing in the block,
      // presses go straight to the caret.
      const typingHere = nodeEl.contains(document.activeElement);
      if (editable && typingHere) return;
      // A note's body isn't contenteditable until you enter it, so without this
      // it was the one text on the canvas that a click could never reach — the
      // title took a caret on the second click while the body needed a
      // double-click, on the same card.
      const noteBody = n.type === 'note' && e.target.closest && e.target.closest('.n-body');
      const caretAt = !alreadySelected ? null
        : editable ? { el: editable, x: e.clientX, y: e.clientY }
        : noteBody ? { el: noteBody, x: e.clientX, y: e.clientY, note: n }
        : null;

      // ⇧ means two different things depending on what happens next: on a
      // click it adds/removes from the selection, on a drag it locks the axis.
      // So a ⇧-press on something already selected defers its toggle to
      // pointerup, and only fires it if the pointer never moved.
      let pendingToggle = null;
      if (e.shiftKey) {
        if (alreadySelected) pendingToggle = n.id;
        else store.select(n.id, true);
      } else if (!alreadySelected) {
        store.select(n.id);
      }

      g.mode = 'drag';
      const moved = App.groups.withChildren([...store.state.selection]);
      g.origin = {
        began: false,
        pendingToggle,
        caretAt,
        items: moved.map(m => ({ id: m.id, x: m.x, y: m.y })),
        // A loose arrow drawn across a section is part of that drawing, so it
        // travels with it: both of its ends must sit inside what's moving.
        loose: looseEdgesWithin(moved).map(e => ({
          id: e.id,
          from: { ...e.fromPt }, to: { ...e.toPt },
        })),
      };
      viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // 6. empty canvas → marquee
    if (!e.shiftKey) store.clearSelection();
    g.mode = 'marquee';
    g.marquee = { x1: s.x, y1: s.y, x2: s.x, y2: s.y, additive: e.shiftKey };
    viewport.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const s = screenOf(e);
    g.lastS = s;
    if (!g.mode) {
      if (g.pendingArrow) {
        const over = nodeAt(e);
        g.arrowTarget = over ? over.id : null;
        renderOverlay();
      }
      return;
    }
    const w = toWorld(s);
    if (Math.abs(s.x - g.startS.x) > 2 || Math.abs(s.y - g.startS.y) > 2) g.moved = true;

    switch (g.mode) {
      case 'pan': {
        const c = cam();
        c.x = g.origin.camX + (s.x - g.startS.x);
        c.y = g.origin.camY + (s.y - g.startS.y);
        applyCamera();
        renderOverlay();
        break;
      }
      case 'drag': {
        if (!g.origin.began) { store.beginChange('move'); g.origin.began = true; }
        let dx = (s.x - g.startS.x) / cam().z;
        let dy = (s.y - g.startS.y) / cam().z;
        g.axis = null;
        if (e.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) { dy = 0; g.axis = 'h'; }
          else { dx = 0; g.axis = 'v'; }
        }
        const moving = [];
        for (const it of g.origin.items) {
          const n = store.nodeById(it.id);
          if (!n) continue;
          n.x = it.x + dx; n.y = it.y + dy;
          moving.push(n);
        }
        for (const it of (g.origin.loose || [])) {
          const ed = store.doc().edges.find(x => x.id === it.id);
          if (!ed) continue;
          ed.fromPt = { x: it.from.x + dx, y: it.from.y + dy };
          ed.toPt   = { x: it.to.x + dx,   y: it.to.y + dy };
        }
        g.guides = [];
        if (e.altKey) {                       // ⌥ = place it exactly where I put it
          for (const n of moving) { n.x = Math.round(n.x); n.y = Math.round(n.y); }
        } else {
          const ids = new Set(moving.map(n => n.id));
          const others = store.doc().nodes.filter(n => !ids.has(n.id) && n.w > 0);
          const hit = App.arrange.snap(moving, others, 7 / cam().z);
          const lockX = g.axis === 'v';   // vertical lock: x must not move
          const lockY = g.axis === 'h';
          for (const n of moving) {
            if (!lockX) n.x = hit.dx ? n.x + hit.dx : Math.round(n.x / 8) * 8;
            if (!lockY) n.y = hit.dy ? n.y + hit.dy : Math.round(n.y / 8) * 8;
          }
          g.guides = hit.guides.filter(gu =>
            (gu.axis === 'v' && !lockX) || (gu.axis === 'h' && !lockY));
        }
        paintOnly();
        break;
      }
      case 'resize': {
        if (!g.origin.began) { store.beginChange('resize'); g.origin.began = true; }
        resizeTo(w, e.shiftKey);
        paintOnly();
        break;
      }
      case 'marquee': {
        g.marquee.x2 = s.x; g.marquee.y2 = s.y;
        renderOverlay();
        break;
      }
      case 'ink': {
        if (e.shiftKey) {
          // ruler mode: keep only the two ends, locked to an axis if close
          const a = g.inkStart || (g.inkStart = g.inkPts[0]);
          const p = App.cad.constrain({ x: a[0], y: a[1] }, w, true, 12);
          g.axis = p.axis || null;
          g.inkPts = [a, [p.x, p.y]];
        } else {
          g.inkStart = null;
          g.axis = null;
          g.inkPts.push([w.x, w.y]);
        }
        renderOverlay();
        break;
      }
      case 'erase': {
        eraseAt(w);
        break;
      }
      case 'dim': {
        const p = App.cad.constrain(g.dimA, w, e.shiftKey);
        g.axis = e.shiftKey ? (p.axis || null) : null;
        const snap = App.cad.snapPoint(p, 11 / cam().z);
        const ok = snap && App.cad.onAxis(g.dimA, snap.p, g.axis);
        g.dimB = ok ? { x: snap.p[0], y: snap.p[1] } : p;
        g.snapDot = ok ? g.dimB : null;
        renderOverlay();
        break;
      }
      case 'dimedit': {
        if (!g.origin.began) { store.beginChange('dimension'); g.origin.began = true; }
        const n = g.origin.node;
        if (g.origin.which === 'off') {
          // project the cursor onto the dimension's normal to set the offset
          const G = App.cad.dimGeometry(n);
          const mid = { x: (G.a[0] + G.b[0]) / 2, y: (G.a[1] + G.b[1]) / 2 };
          n.off = Math.round((w.x - mid.x) * G.nx + (w.y - mid.y) * G.ny);
        } else {
          // the other end stays put, so constrain against it
          const other = g.origin.which === 0 ? 1 : 0;
          const anchor = { x: n.x + n.pts[other][0], y: n.y + n.pts[other][1] };
          const c = App.cad.constrain(anchor, w, e.shiftKey);
          g.axis = e.shiftKey ? (c.axis || null) : null;
          const snap = App.cad.snapPoint(c, 11 / cam().z, n.id);
          const ok = snap && App.cad.onAxis(anchor, snap.p, g.axis);
          const p = ok ? { x: snap.p[0], y: snap.p[1] } : c;
          g.snapDot = ok ? p : null;
          n.pts[g.origin.which] = [p.x - n.x, p.y - n.y];
        }
        App.cad.reflowDim(n);
        const el = NODES.elOf(n.id);
        if (el) el._key = null;
        paintOnly();
        break;
      }
      case 'connect': {
        const over = nodeAt(e);
        g.arrowTarget = over ? over.id : null;
        renderOverlay();
        break;
      }
      case 'arrowend': {
        if (!g.origin.began) { store.beginChange('arrow'); g.origin.began = true; }
        const over = nodeAt(e);
        g.arrowTarget = over ? over.id : null;
        g.arrowAnchor = over ? mountAt(over, w) : null;
        App.arrows.setEnd(g.origin.edge, g.origin.which,
          over ? { node: over.id, anchor: g.arrowAnchor } : w);
        paintOnly();
        break;
      }
      case 'arrowmove': {
        if (!g.origin.began) { store.beginChange('arrow'); g.origin.began = true; }
        App.arrows.move(g.origin.edge, w.x - g.origin.last.x, w.y - g.origin.last.y);
        g.origin.last = w;
        paintOnly();
        break;
      }
    }
  }

  function onPointerUp(e) {
    const mode = g.mode;
    if (!mode) return;
    const s = screenOf(e);

    if (mode === 'pan') {
      viewport.classList.remove('panning');
      store.saveCamera();
    }

    if (mode === 'drag') {
      if (g.origin.began) store.commit();
      else if (g.origin.pendingToggle && !g.moved) store.toggleSelect(g.origin.pendingToggle);
      else if (g.origin.caretAt && !g.moved) placeCaret(g.origin.caretAt);
    }
    if (mode === 'resize' && g.origin.began) store.commit();

    if (mode === 'marquee') {
      const m = g.marquee;
      const a = toWorld({ x: Math.min(m.x1, m.x2), y: Math.min(m.y1, m.y2) });
      const b = toWorld({ x: Math.max(m.x1, m.x2), y: Math.max(m.y1, m.y2) });
      const box = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      if (box.w > 3 || box.h > 3) {
        // Blocks are caught by touching the marquee; a section only when it is
        // enclosed outright — otherwise every box drawn inside a section would
        // drag the whole section along with what you picked.
        const encloses = (r) => r.x >= box.x && r.y >= box.y &&
                                r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h;
        const hit = store.doc().nodes.filter(n => {
          const r = U.nodeRect(n);
          return n.type === 'group' ? encloses(r) : U.rectsOverlap(box, r);
        }).map(n => n.id);
        if (hit.length) store.select(hit, m.additive);
      }
      g.marquee = null;
    }

    if (mode === 'dim') {
      const a = g.dimA, b = g.dimB;
      if (a && b && Math.hypot(b.x - a.x, b.y - a.y) > 4) {
        store.addNode(App.cad.createDim(a, b));
      }
      g.dimA = g.dimB = null;
      // stays active: drafting means placing several in a row (Esc or V to stop)
    }
    if (mode === 'dimedit' && g.origin.began) store.commit({ full: true });

    if (mode === 'ink') commitStroke();
    if (mode === 'erase') store.commit({ full: true });

    if (mode === 'connect') {
      const start = g.connectFrom;
      const over = nodeAt(e);
      const w = toWorld(s);
      const far = g.moved && Math.hypot(s.x - g.startS.x, s.y - g.startS.y) > 12;

      if (far) {
        finishArrow(start, over ? { node: over.id, anchor: mountAt(over, w) } : w);
      } else if (start.node) {
        // a click, not a drag: wait for the second click to say where it goes
        g.pendingArrow = { start };
        App.app.toast('Now click where the arrow should point');
      }
      g.connectFrom = null;
      g.arrowTarget = null;
    }
    if (mode === 'arrowend' && g.origin.began) { g.arrowTarget = null; store.commit({ full: true }); }
    if (mode === 'arrowmove' && g.origin.began) store.commit({ full: true });

    g.mode = null;
    g.origin = null;
    g.inkPts = null;
    g.inkStart = null;
    g.guides = null;
    g.snapDot = null;
    g.axis = null;
    try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
    render();
  }

  /** Commit a new arrow. Either end may be a block or a bare point. */
  /** Turn a drop point into a mount: near a corner or edge-middle it welds
   *  there, elsewhere the end stays floating and slides to face the other. */
  function mountAt(node, w) {
    const tol = 30 / cam().z;
    return App.arrows.nearestAnchor(node, w, tol);
  }

  function finishArrow(start, end) {
    if (start.node && end.node && start.node === end.node) return;
    const e = App.arrows.make(start, end);
    const prefs = store.state.arrowPrefs;
    if (prefs) { e.style = prefs.style; e.heads = prefs.heads; }
    store.beginChange('arrow');
    store.doc().edges.push(e);
    store.clearSelection();
    store.state.selectedEdge = e.id;
    store.commit({ full: true });
    store.emit('selection-changed');
  }

  /** Geometry-only repaint — cheap enough for every pointermove. */
  function paintOnly() {
    const d = store.doc();
    for (const n of d.nodes) {
      const el = NODES.elOf(n.id);
      if (el) NODES.paint(n, el);
    }
    renderEdges(d);
    App.comments.renderPins(d);
    renderOverlay();
    panelsSoon();
  }

  function resizeTo(w, keepRatio) {
    const { corner, box, node } = g.origin;
    const MIN = 40;
    let x = box.x, y = box.y, ww = box.w, hh = box.h;

    if (corner.includes('e')) ww = Math.max(MIN, w.x - box.x);
    if (corner.includes('s')) hh = Math.max(MIN, w.y - box.y);
    if (corner.includes('w')) { const r = box.x + box.w; x = Math.min(w.x, r - MIN); ww = r - x; }
    if (corner.includes('n')) { const b = box.y + box.h; y = Math.min(w.y, b - MIN); hh = b - y; }

    // ⇧ (or an image/drawing, which shouldn't distort) keeps the aspect ratio.
    const oneAxis = corner.length === 1;

    // A side handle with ⇧ held drives the other axis from the one you're
    // dragging, anchored on the opposite edge — without it, ⇧ on an edge did
    // nothing at all.
    if (keepRatio && oneAxis) {
      const ratio = box.w / box.h;
      if (corner === 'e' || corner === 'w') hh = Math.max(MIN, ww / ratio);
      else ww = Math.max(MIN, hh * ratio);
      if (corner === 'w') x = box.x + box.w - ww;
      if (corner === 'n') y = box.y + box.h - hh;
    }

    // Single-axis edges otherwise opt out: dragging the right edge should only
    // change width.
    if ((keepRatio || node.type === 'image' || node.type === 'ink') && !oneAxis) {
      const ratio = box.w / box.h;
      if (ww / hh > ratio) ww = hh * ratio; else hh = ww / ratio;
      if (corner.includes('w')) x = box.x + box.w - ww;
      if (corner.includes('n')) y = box.y + box.h - hh;
    }

    // A multiple selection scales as one: every block keeps its place inside
    // the box, proportionally.
    if (g.origin.group) {
      const sx = ww / box.w, sy = hh / box.h;
      for (const it of g.origin.group) {
        const n2 = store.nodeById(it.id);
        if (!n2) continue;
        n2.x = x + (it.x - box.x) * sx;
        n2.y = y + (it.y - box.y) * sy;
        if (n2.type !== 'dim') { n2.w = Math.max(4, it.w * sx); n2.h = Math.max(4, it.h * sy); }
      }
      return;
    }

    if (node.type === 'dim') return;
    if (node.type === 'ink' && box.w && box.h) {
      const sx = ww / box.w, sy = hh / box.h;
      // rescale from the pristine copy so repeated moves don't compound
      if (!g.origin.pristine) g.origin.pristine = structuredClone(node.strokes);
      node.strokes = structuredClone(g.origin.pristine);
      for (const st of node.strokes) {
        for (const p of st.points) { p[0] *= sx; p[1] *= sy; }
        st.size = Math.max(0.6, st.size * Math.min(sx, sy));
      }
    }

    node.x = Math.round(x); node.y = Math.round(y);
    node.w = Math.round(ww); node.h = Math.round(hh);
  }

  // ── ink ─────────────────────────────────────────────────────────────────
  function commitStroke() {
    const pts = U.thin(g.inkPts || [], 1.2 / cam().z);
    if (pts.length < 2) return;
    const pen = store.state.pen;
    const n = NODES.create('ink', 0, 0);
    n.strokes = [{ color: pen.color, size: pen.size, points: pts.map(p => [p[0], p[1]]) }];
    NODES.reflowInk(n);
    store.addNode(n, { select: false });
  }

  function eraseAt(w) {
    const rad = 9 / cam().z;
    const hits = inkHits(w, rad);
    if (!hits.length) return;
    const d = store.doc();
    for (const h of hits) {
      h.node.strokes.splice(h.index, 1);
      if (!h.node.strokes.length) {
        d.nodes = d.nodes.filter(x => x.id !== h.node.id);
      } else {
        NODES.reflowInk(h.node);
      }
    }
    store.state.doc.nodes = d.nodes;
    render();
  }

  // ── wheel / trackpad ────────────────────────────────────────────────────
  function onWheel(e) {
    e.preventDefault();
    const s = screenOf(e);
    if (e.ctrlKey || e.metaKey) {
      zoomAt(s.x, s.y, Math.exp(-e.deltaY * 0.01));
    } else {
      const c = cam();
      c.x -= e.deltaX;
      c.y -= e.deltaY;
      applyCamera();
      renderOverlay();
      store.saveCamera();
    }
  }

  function onDblClick(e) {
    const el = nodeElAt(e);
    if (el) {
      const n = store.nodeById(el.dataset.id);
      if (n && n.type === 'group') {          // step inside: select its contents
        const kids = App.groups.childrenOf(n);
        if (kids.length) store.select(kids.map(k => k.id));
        return;
      }
      if (n && n.type === 'note' && e.target.closest('.n-body')) NODES.beginBodyEdit(n, el);
      else if (n) focusNode(n.id);
      return;
    }
    const w = toWorld(screenOf(e));
    const def = NODES.DEFAULTS.note;
    const n = NODES.create('note', w.x - def.w / 2, w.y - def.h / 2);
    store.addNode(n);
    requestAnimationFrame(() => focusNode(n.id));
  }

  /** Drop the caret exactly where the pointer was released. */
  function placeCaret({ el, x, y, note }) {
    if (note) {                                   // swap rendered markdown for source
      const nodeEl = el.closest('.node');
      NODES.beginBodyEdit(note, nodeEl);
      el = nodeEl.querySelector('.n-body');
    }
    el.focus();
    const range = document.caretRangeFromPoint
      ? document.caretRangeFromPoint(x, y)
      : null;
    const sel = window.getSelection();
    sel.removeAllRanges();
    if (range) {
      sel.addRange(range);
    } else {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.addRange(r);
    }
  }

  /** Put the caret in a node's primary text field. */
  function focusNode(id) {
    const el = NODES.elOf(id);
    if (!el) return;
    const target = el.querySelector('.n-title, .s-text, .t-title, .sh-text, .gr-label, .tb-cell');
    if (!target) return;
    target.focus();
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function cancelPending() {
    if (!g.pendingArrow) return false;
    g.pendingArrow = null;
    g.arrowTarget = null;
    renderOverlay();
    return true;
  }

  function setSpace(down) { g.spaceDown = down; }
  function busy() { return !!g.mode; }

  function mount() {
    viewport   = document.getElementById('viewport');
    world      = document.getElementById('world');
    layerNodes = document.getElementById('layer-nodes');
    layerPins  = document.getElementById('layer-pins');
    edgeSvg    = document.getElementById('edges');
    overlay    = document.getElementById('overlay');
    emptyHint  = document.getElementById('empty-hint');

    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerUp);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('dblclick', onDblClick);
  }

  return {
    mount, render, paintOnly, renderOverlay, applyCamera, cameraOnly,
    toWorld, toScreen, screenOf, zoomAt, zoomTo, zoomToFit, zoomToSelection,
    centerOn, centerOnPoint, ensureVisible,
    focusNode, setSpace, busy, nodeAt, borderPoint, edgeAt, edgeSamples, cancelPending, paintGrid,
    get viewportEl() { return viewport; },
    get pinLayer() { return layerPins; },
  };
})();
