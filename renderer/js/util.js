'use strict';
window.App = window.App || {};

App.util = (() => {
  const uid = (p = 'n') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const debounce = (fn, ms) => {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  const rectsOverlap = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  const nodeRect = (n) => ({ x: n.x, y: n.y, w: n.w, h: n.h });

  /** Bounding box of a list of nodes; null when the list is empty. */
  function bbox(nodes) {
    if (!nodes.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const n of nodes) {
      x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y);
      x2 = Math.max(x2, n.x + n.w); y2 = Math.max(y2, n.y + n.h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  /** Catmull-Rom-ish smoothing → SVG path. Used for freehand ink. */
  function strokePath(pts) {
    if (!pts.length) return '';
    if (pts.length < 3) return `M ${pts.map(p => `${r(p[0])} ${r(p[1])}`).join(' L ')}`;
    let d = `M ${r(pts[0][0])} ${r(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q ${r(pts[i][0])} ${r(pts[i][1])} ${r(mx)} ${r(my)}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${r(last[0])} ${r(last[1])}`;
    return d;
  }
  const r = (v) => Math.round(v * 100) / 100;

  /** Drop points closer than `min` px — keeps stored strokes small. */
  function thin(pts, min = 1.6) {
    const out = [];
    for (const p of pts) {
      const l = out[out.length - 1];
      if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) >= min) out.push(p);
    }
    if (out.length < 2 && pts.length) out.push(pts[pts.length - 1]);
    return out;
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  const timeAgo = (ts) => {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    return new Date(ts).toLocaleDateString();
  };

  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  /** Relative luminance of a #rrggbb colour, 0..1. */
  function lum(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return 0.5;
    const v = parseInt(m[1], 16);
    return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
  }

  /** While exporting to a white page, near-white strokes would vanish; swap
   *  them for near-black. Everything else keeps the colour the user chose. */
  function forPrint(color) {
    if (!App.exporter || !App.exporter.isLight()) return color;
    return lum(color) > 0.72 ? '#1b1b20' : color;
  }

  return { uid, clamp, esc, debounce, rectsOverlap, nodeRect, bbox, strokePath, thin,
           distToSegment, timeAgo, el, r, lum, forPrint };
})();

/* Two palettes. The studio one is the FigJam-ish set; the drafting one is what
   you'd actually put on a drawing — ink, graphite and a few standard line
   colours, no highlighter yellow. `App.palette.use()` swaps them in place so
   every existing reference picks up the change. */
App.palettes = {
  studio: {
    sticky: ['#ffd868', '#ffb37a', '#ff9aa8', '#c9a7ff', '#8fd3ff', '#8ee6b8', '#e6e6e6', '#ffffff'],
    shape:  ['#7c6cff', '#4ec9a0', '#f2b45c', '#ff7a8a', '#59a9ff', '#9a9aa8', '#2f2f38'],
    ink:    ['#e8e8ee', '#7c6cff', '#4ec9a0', '#f2b45c', '#ff7a8a', '#59a9ff', '#16161a'],
  },
  drafting: {
    // paper tones for cards — legible printed, not decorative
    sticky: ['#ffffff', '#f3f4f6', '#e9edf2', '#e7eefb', '#e9f4ec', '#fbecea', '#f6f1e4', '#dfe3e8'],
    // line colours from drafting convention: ink, graphite, and the standard trio
    shape:  ['#12141a', '#4a5058', '#8b929b', '#b03a2e', '#1c58c0', '#1a7f4b'],
    ink:    ['#12141a', '#4a5058', '#b03a2e', '#1c58c0', '#1a7f4b', '#8b6d1f', '#8b929b'],
  },
};

App.palette = {
  sticky: [...App.palettes.studio.sticky],
  shape:  [...App.palettes.studio.shape],
  ink:    [...App.palettes.studio.ink],

  /** Swap the live arrays in place for the given theme. */
  use(theme) {
    const set = App.palettes[theme] || App.palettes.studio;
    this.sticky.length = 0; this.sticky.push(...set.sticky);
    this.shape.length = 0;  this.shape.push(...set.shape);
    this.ink.length = 0;    this.ink.push(...set.ink);
  },
};

/* Inline SVG icons — sharper than emoji glyphs, and they take currentColor. */
App.icons = {
  folder: '<svg class="ico-folder" viewBox="0 0 48 48" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M 8.5 8 C 6.0324991 8 4 10.032499 4 12.5 L 4 35.5 C 4 37.967501 6.0324991 40 8.5 40 L 39.5 40 C 41.967501 40 44 37.967501 44 35.5 L 44 17.5 C 44 15.032499 41.967501 13 39.5 13 L 24.042969 13 L 19.572266 9.2753906 C 18.584055 8.4521105 17.339162 8 16.052734 8 L 8.5 8 z M 8.5 11 L 16.052734 11 C 16.638307 11 17.202555 11.205358 17.652344 11.580078 L 21.15625 14.5 L 17.652344 17.419922 C 17.202555 17.794642 16.638307 18 16.052734 18 L 7 18 L 7 12.5 C 7 11.653501 7.6535009 11 8.5 11 z M 24.042969 16 L 39.5 16 C 40.346499 16 41 16.653501 41 17.5 L 41 35.5 C 41 36.346499 40.346499 37 39.5 37 L 8.5 37 C 7.6535009 37 7 36.346499 7 35.5 L 7 21 L 16.052734 21 C 17.339162 21 18.584055 20.547889 19.572266 19.724609 L 24.042969 16 z"/></svg>',
};
