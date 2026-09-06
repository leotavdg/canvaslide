'use strict';
/* ===========================================================================
   nodes.js — node factories + DOM rendering.

   Every node is a positioned <div> inside #world. Content is patched in place
   so typing is never interrupted: if focus lives inside a node, we leave its
   innards alone and only update geometry.
   =========================================================================== */
App.nodes = (() => {
  const U = App.util;
  const S = () => App.store;
  const NBSP = / /g;

  // ── factories ───────────────────────────────────────────────────────────
  const DEFAULTS = {
    note:   { w: 320, h: 200 },
    sticky: { w: 170, h: 170 },
    todo:   { w: 280, h: 190 },
    shape:  { w: 200, h: 120 },
    image:  { w: 260, h: 180 },
    table:  { w: 380, h: 180 },
    group:  { w: 520, h: 380 },
    embed:  { w: 300, h: 220 },
    link:   { w: 280, h: 110 },
    dim:    { w: 180, h: 60 },
    title:  { w: 420, h: 128 },
  };

  function create(type, x, y, extra = {}) {
    const d = DEFAULTS[type] || { w: 200, h: 140 };
    const base = { id: U.uid(type), type, x: Math.round(x), y: Math.round(y), w: d.w, h: d.h, z: 0 };
    switch (type) {
      case 'note':   return { ...base, title: '', body: '', ...extra };
      case 'sticky': return { ...base, text: '', color: App.palette.sticky[0], ...extra };
      case 'todo':   return { ...base, title: 'Checklist', items: [{ id: U.uid('i'), text: '', done: false }], ...extra };
      case 'shape':  return { ...base, kind: 'rect', color: App.palette.shape[0], filled: false,
                               stroke: 2, fs: 13, text: '', ...extra };
      case 'image':  return { ...base, src: '', ...extra };
      case 'ink':    return { ...base, w: 0, h: 0, strokes: [], ...extra };
      case 'dim':    return { ...base, w: 0, h: 0, pts: [[0, 0], [100, 0]], off: 26,
                              color: App.palette.ink[0], label: '', ...extra };
      case 'table':  return {
        ...base,
        cols: ['Name', 'Status'],
        rows: [['', ''], ['', '']],
        ...extra,
      };
      case 'group':  return { ...base, label: 'Section', color: App.palette.shape[0], ...extra };
      case 'embed':  return { ...base, pageId: null, pageName: '', ...extra };
      case 'link':   return { ...base, url: '', title: '', ...extra };
      case 'title':  return {
        ...base,
        project: 'PROJECT', drawing: 'GENERAL ARRANGEMENT',
        drawnBy: '', checkedBy: '', date: '', rev: 'A', sheet: '1 / 1',
        ...extra,
      };
      default:       return { ...base, ...extra };
    }
  }

  /** Recompute an ink node's box from its strokes (points are node-relative). */
  function reflowInk(n) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const s of n.strokes) for (const p of s.points) {
      x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]);
      x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]);
    }
    if (!isFinite(x1)) { n.w = 0; n.h = 0; return; }
    const pad = Math.max(...n.strokes.map(s => s.size)) + 2;
    const dx = x1 - pad, dy = y1 - pad;
    if (dx || dy) {
      for (const s of n.strokes) for (const p of s.points) { p[0] -= dx; p[1] -= dy; }
      n.x += dx; n.y += dy;
    }
    n.w = (x2 - x1) + pad * 2;
    n.h = (y2 - y1) + pad * 2;
  }

  /** Images are stored vault-relative ("assets/x.png") so a vault can move
   *  between Macs; absolute and data: URLs pass straight through. */
  function assetUrl(src) {
    const s = String(src || '');
    if (!s) return '';
    if (/^(file:|https?:|data:)/i.test(s)) return s;
    return 'file://' + encodeURI(`${S().state.vaultPath}/${s}`);
  }

  // ── rendering ───────────────────────────────────────────────────────────
  const drafting = () => document.getElementById('app').classList.contains('drafting');
  const light = () => App.exporter && App.exporter.isLight() ? 'L' : 'D';
  // wikilinks change look when a page appears or is renamed, so blocks that
  // hold one re-render when the vault changes
  const linky = (t) => (t && t.includes('[[')) ? '|v' + S().state.vaultRev : '';

  /** Signature of a node's *content*; when it changes we re-render the guts. */
  function contentKey(n) {
    switch (n.type) {
      case 'note':   return `${n.title} ${n.body}${linky(n.body)}`;
      case 'sticky': return `${n.text} ${n.color}${linky(n.text)}`;
      case 'todo':   return `${n.title} ` + n.items.map(i => `${i.done ? 1 : 0}${i.text}`).join('');
      case 'shape':  return `${n.kind} ${n.color} ${n.filled} ${n.stroke} ${n.fs} ${n.text} ${drafting() ? 'D' : 'S'}`;
      case 'image':  return `${n.src || ''}@${S().state.vaultPath}`;
      case 'ink':    return `${n.strokes.length}:${n.w}x${n.h}:${light()}:` + n.strokes.map(s => s.points.length + s.color + s.size).join(',');
      case 'dim':    return `${n.pts.map(p => p.join(',')).join(';')}|${n.off}|${n.color}|${n.weight}|${n.fs}|${n.label}|${App.cad.scaleKey()}|${light()}`;
      case 'table':  return n.cols.join('|') + '#' + n.rows.map(r => r.join('|')).join('#');
      case 'group':  return `${n.label} ${n.color} ${n.fs} ${n.sheet || ''} ${n.orient || ''}`;
      case 'embed':  return `${n.pageId} ${n.pageName} ${App.store.embedRevision(n.pageId)}`;
      case 'link':   return `${n.url} ${n.title}`;
      case 'title':  return [n.project, n.drawing, n.drawnBy, n.checkedBy, n.date, n.rev, n.sheet,
                             App.cad.scaleKey()].join('|');
      default:       return '';
    }
  }

  // id → element, so repaints don't scan the layer once per node
  const els = new Map();
  function elOf(id) {
    const el = els.get(id);
    if (el && el.isConnected) return el;
    if (el) els.delete(id);
    return null;
  }

  function ensureEl(n, layer) {
    let el = elOf(n.id);
    if (!el) {
      el = document.createElement('div');
      el.className = `node ${n.type}`;
      el.dataset.id = n.id;
      el.dataset.type = n.type;
      layer.appendChild(el);
      el._key = null;
      els.set(n.id, el);
    }
    return el;
  }

  function forget(id) { els.delete(id); }

  function paint(n, el) {
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.style.zIndex = String((n.type === 'group' ? 200 : 1000) + (n.z || 0));
    el.style.width = Math.max(n.w, 1) + 'px';
    el.style.height = Math.max(n.h, 1) + 'px';
    el.classList.toggle('selected', S().state.selection.has(n.id));
    // --fs is read by the type's own CSS; a node without one keeps the default
    if (n.fs == null) el.style.removeProperty('--fs');
    else el.style.setProperty('--fs', n.fs);

    // Don't stomp on a node the user is typing inside.
    const editing = el.contains(document.activeElement);
    const key = contentKey(n);
    if (!editing && key !== el._key) {
      el.innerHTML = inner(n);
      el._key = key;
    }
    if (n.type === 'sticky') el.style.background = n.color;
  }

  function inner(n) {
    switch (n.type) {
      case 'note': return `
        <div class="n-title" data-field="title" contenteditable="true">${U.esc(n.title)}</div>
        <div class="n-body md" data-field="body">${
          n.body && n.body.trim()
            ? App.md.render(n.body)
            : '<p style="color:var(--text-mute)">Click to write markdown…</p>'}</div>`;

      case 'sticky': return `
        <div class="s-text" data-field="text" contenteditable="true">${U.esc(n.text)}</div>`;

      case 'todo': {
        const done = n.items.filter(i => i.done).length;
        const pct = n.items.length ? Math.round(done / n.items.length * 100) : 0;
        return `
        <div class="t-title" data-field="title" contenteditable="true">${U.esc(n.title)}</div>
        <div class="t-items">
          ${n.items.map(i => `
            <div class="t-row ${i.done ? 'done' : ''}" data-item="${i.id}">
              <div class="t-box ${i.done ? 'on' : ''}" data-act="toggle">${i.done ? '✓' : ''}</div>
              <div class="t-text" contenteditable="true" data-act="text">${U.esc(i.text)}</div>
            </div>`).join('')}
          <div class="t-add" data-act="add">+ add</div>
        </div>
        <div class="t-progress"><i style="width:${pct}%"></i></div>`;
      }

      case 'shape': {
        const fill = n.filled ? n.color : 'transparent';
        const sw = n.stroke == null ? 2 : n.stroke;
        const poly = (pts) => `<polygon points="${pts}" fill="${fill}" stroke="${n.color}"
          stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
        let shape, vb = '';
        switch (n.kind) {
          case 'ellipse':
            shape = `<ellipse cx="50%" cy="50%" rx="49%" ry="49%" fill="${fill}" stroke="${n.color}"
                     stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;
            break;
          case 'diamond':
            vb = ' viewBox="0 0 100 100" preserveAspectRatio="none"';
            shape = poly('50,2 98,50 50,98 2,50');
            break;
          case 'triangle':
            vb = ' viewBox="0 0 100 100" preserveAspectRatio="none"';
            shape = poly('50,3 98,97 2,97');
            break;
          case 'line':
            vb = ' viewBox="0 0 100 100" preserveAspectRatio="none"';
            shape = `<line x1="2" y1="98" x2="98" y2="2" stroke="${n.color}" stroke-width="${sw}"
                     stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
            break;
          default: {
            shape = `<rect x="${sw / 2}" y="${sw / 2}" width="calc(100% - ${sw}px)" height="calc(100% - ${sw}px)"
                     rx="${drafting() ? 0 : 8}" fill="${fill}" stroke="${sw ? n.color : 'none'}" stroke-width="${sw}"
                     vector-effect="non-scaling-stroke"/>`;
          }
        }
        return `
        <svg class="sh-fill" width="100%" height="100%"${vb} style="--sw:${sw}">${shape}</svg>
        <div class="sh-text" data-field="text" contenteditable="true"
             style="--fs:${n.fs == null ? 13 : n.fs}">${U.esc(n.text)}</div>`;
      }

      case 'dim':
        return App.cad.renderDim(n);   // svg + an editable label overlay

      case 'image':
        return n.src
          ? `<img src="${U.esc(assetUrl(n.src))}" draggable="false">`
          : `<div style="padding:14px;color:var(--text-mute)">No image</div>`;

      case 'ink': {
        const paths = n.strokes.map(s =>
          `<path d="${U.strokePath(s.points)}" stroke="${U.forPrint(s.color)}" stroke-width="${s.size}"
                 opacity="${s.opacity == null ? 1 : s.opacity}"/>`).join('');
        return `<svg width="100%" height="100%" viewBox="0 0 ${Math.max(n.w, 1)} ${Math.max(n.h, 1)}">${paths}</svg>`;
      }
      case 'table': {
        const head = n.cols.map((c, i) =>
          `<th><div class="tb-cell" contenteditable="true" data-col="${i}">${U.esc(c)}</div></th>`).join('');
        const body = n.rows.map((row, r) => `<tr>${
          row.map((cell, c) =>
            `<td><div class="tb-cell" contenteditable="true" data-r="${r}" data-c="${c}">${U.esc(cell)}</div></td>`
          ).join('')}</tr>`).join('');
        return `
          <div class="tb-scroll">
            <table class="tb"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
          </div>
          <div class="tb-add">
            <span data-act="row">+ row</span><span data-act="col">+ column</span>
          </div>`;
      }

      case 'group': {
        const sheet = n.sheet
          ? `<span class="gr-sheet">${U.esc(n.sheet)} ${U.esc(n.orient === 'landscape' ? 'landscape' : 'portrait')}</span>`
          : '';
        return `
        <div class="gr-frame${n.sheet ? ' gr-paper' : ''}" style="border-color:${U.esc(n.color)}"></div>
        <div class="gr-label" data-field="label" contenteditable="true"
             style="--fs:${n.fs == null ? 12 : n.fs};color:${U.esc(n.color)}">${U.esc(n.label)}</div>${sheet}`;
      }

      case 'embed': {
        const doc = App.store.docById(n.pageId);
        if (!doc) return `<div class="em-head">Missing page</div>
          <div class="em-body" style="color:var(--text-mute);padding:12px">
            ${U.esc(n.pageName || 'unknown')} is not in this vault.</div>`;
        const blocks = (doc.nodes || [])
          .filter(x => ['note', 'sticky', 'todo'].includes(x.type))
          .sort((a, b) => (a.y - b.y) || (a.x - b.x))
          .slice(0, 12);
        const body = blocks.map(x => {
          if (x.type === 'note') {
            return `<div class="em-block"><b>${U.esc(x.title || 'Untitled')}</b>
                    <div>${App.md.render((x.body || '').slice(0, 400))}</div></div>`;
          }
          if (x.type === 'todo') {
            return `<div class="em-block"><b>${U.esc(x.title || '')}</b>` +
              (x.items || []).map(i =>
                `<div class="em-task">${i.done ? '☑' : '☐'} ${i.done ? '<s>' : ''}${U.esc(i.text)}${i.done ? '</s>' : ''}</div>`
              ).join('') + `</div>`;
          }
          return `<div class="em-block">${U.esc(x.text || '')}</div>`;
        }).join('') || '<div class="em-block" style="color:var(--text-mute)">Empty page</div>';
        return `<div class="em-head" data-act="open">↗ ${U.esc(doc.name)}</div>
                <div class="em-body md">${body}</div>`;
      }

      case 'title': {
        const s2 = App.cad.scale();
        // a title block says 1:50, not "1 px = 50 mm"
        const preset = App.cad.PRESETS.find(p => Math.abs(p.f - Number(s2.perPx)) < 1e-9);
        const scaleTxt = s2.unit === 'px' ? 'NTS'
          : preset ? preset.label
          : Number.isInteger(Number(s2.perPx)) ? `1:${s2.perPx}`
          : `1 px = ${s2.perPx} ${s2.unit}`;
        const f = (key, label, value, cls) => `
          <div class="tb-field ${cls || ''}">
            <span class="tb-key">${label}</span>
            <span class="tb-val" data-field="${key}" contenteditable="true">${U.esc(value || '')}</span>
          </div>`;
        return `
          <div class="title-block">
            <div class="tb-main">
              ${f('project', 'PROJECT', n.project, 'tb-lg')}
              ${f('drawing', 'DRAWING', n.drawing, 'tb-lg')}
            </div>
            <div class="tb-grid">
              ${f('drawnBy', 'DRAWN', n.drawnBy)}
              ${f('checkedBy', 'CHK', n.checkedBy)}
              ${f('date', 'DATE', n.date)}
              <div class="tb-field"><span class="tb-key">SCALE</span>
                <span class="tb-val tb-auto">${U.esc(scaleTxt)}</span></div>
              ${f('rev', 'REV', n.rev)}
              ${f('sheet', 'SHEET', n.sheet)}
            </div>
          </div>`;
      }

      case 'link':
        return `<div class="lk" data-act="open">
          <div class="lk-title">${U.esc(n.title || n.url)}</div>
          <div class="lk-url">${U.esc(n.url)}</div></div>`;

      default: return '';
    }
  }

  // ── editing ─────────────────────────────────────────────────────────────
  /** Note bodies edit as rendered markdown, then convert back on blur. */
  function beginBodyEdit(node, el) {
    const body = el.querySelector('.n-body');
    if (!body || body.classList.contains('editing')) return;
    // Edit the rendered markdown in place. The old path replaced the body with
    // its own source, which re-flowed the whole card the moment you clicked in
    // and turned every table back into rows of pipes.
    body.classList.add('editing');
    body.setAttribute('contenteditable', 'true');
    if (!node.body || !node.body.trim()) body.innerHTML = '';   // drop the placeholder
    body.focus();
    const range = document.createRange();
    range.selectNodeContents(body);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** `began` says whether an undo snapshot was already taken for this edit. A
   *  body that was clicked into and left untouched commits nothing at all. */
  function endBodyEdit(node, el, began = false) {
    const body = el.querySelector('.n-body');
    if (!body || !body.classList.contains('editing')) return;
    const md = App.md.toMarkdown(body).replace(NBSP, ' ');
    body.classList.remove('editing');
    body.removeAttribute('contenteditable');
    const same = md.trim() === String(node.body || '').trim();
    if (same && !began) { el._key = null; App.canvas.render(); return; }
    if (!began) App.store.beginChange('edit');
    node.body = md;
    el._key = null;
    App.store.commit();
  }

  return { create, reflowInk, ensureEl, elOf, forget, paint, inner, contentKey, assetUrl,
           beginBodyEdit, endBodyEdit, DEFAULTS };
})();
