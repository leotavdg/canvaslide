'use strict';
/* ===========================================================================
   jsoncanvas.js — read/write JSON Canvas 1.0 (https://jsoncanvas.org).

   This is the open format Obsidian created for infinite-canvas data and that
   other canvas apps (Kinopio and friends) already import. Supporting it is the
   difference between "your notes live in my app" and "your notes are yours":
   export a page and it opens in Obsidian Canvas.

   Spec nodes are text | file | link | group. Our richer blocks are mapped down
   to `text` with markdown, which is exactly how the format expects extras to
   degrade — and we keep a private `canvaslide` block so a round-trip through
   our own app is lossless.
   =========================================================================== */
App.jsoncanvas = (() => {
  const U = App.util;
  const store = App.store;

  // ── export ──────────────────────────────────────────────────────────────
  /** Render one of our nodes as the markdown a spec `text` node would hold. */
  function toMarkdown(n) {
    switch (n.type) {
      case 'note':
        return (n.title ? `# ${n.title}\n\n` : '') + (n.body || '');
      case 'sticky':
        return n.text || '';
      case 'todo':
        return (n.title ? `## ${n.title}\n\n` : '') +
          (n.items || []).map(i => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n');
      case 'shape':
        return n.text || '';
      case 'table': {
        const cols = n.cols || [];
        if (!cols.length) return '';
        return [
          `| ${cols.join(' | ')} |`,
          `| ${cols.map(() => '---').join(' | ')} |`,
          ...(n.rows || []).map(r => `| ${cols.map((_, i) => (r[i] || '').replace(/\|/g, '\\|')).join(' | ')} |`),
        ].join('\n');
      }
      case 'embed':
        return `![[${n.pageName || ''}]]`;
      case 'link':
        return n.url ? `[${n.title || n.url}](${n.url})` : '';
      case 'ink':
        return '';   // handled below as a file-less placeholder
      default:
        return store.nodeText(n);
    }
  }

  function docToCanvas(doc) {
    const nodes = [];
    const ordered = [...doc.nodes].sort((a, b) => (a.z || 0) - (b.z || 0));

    for (const n of ordered) {
      const base = {
        id: n.id,
        x: Math.round(n.x), y: Math.round(n.y),
        width: Math.round(Math.max(n.w, 1)), height: Math.round(Math.max(n.h, 1)),
      };
      if (n.type === 'group') {
        nodes.push({ ...base, type: 'group', label: n.label || 'Section', canvaslide: n });
        continue;
      }
      if (n.type === 'link' && n.url) {
        nodes.push({ ...base, type: 'link', url: n.url, canvaslide: n });
        continue;
      }
      if (n.type === 'image' && n.src) {
        // strip the file:// + vault prefix so the path stays vault-relative
        const rel = String(n.src).replace(/^file:\/\//, '').replace(store.state.vaultPath + '/', '');   // already relative for new files
        nodes.push({ ...base, type: 'file', file: rel, canvaslide: n });
        continue;
      }
      const text = toMarkdown(n);
      const node = { ...base, type: 'text', text, canvaslide: n };
      if (n.type === 'sticky' && n.color) node.color = n.color;
      if (n.type === 'shape' && n.color) node.color = n.color;
      if (n.type === 'ink') node.text = '<!-- drawing -->';
      nodes.push(node);
    }

    // The spec's edges require a node at both ends, so arrows with a loose end
    // stay in our own file rather than being exported wrong.
    const edges = (doc.edges || [])
      .filter(e => e.from && e.to)
      .map(e => ({
        id: e.id,
        fromNode: e.from,
        toNode: e.to,
        toEnd: (e.heads === 'none' || e.heads === 'start') ? 'none' : 'arrow',
        fromEnd: (e.heads === 'both' || e.heads === 'start') ? 'arrow' : 'none',
        // the spec only has four sides, so corner mounts round to the nearest
        ...(SIDE[e.fromAnchor] ? { fromSide: SIDE[e.fromAnchor] } : {}),
        ...(SIDE[e.toAnchor] ? { toSide: SIDE[e.toAnchor] } : {}),
        ...(e.label ? { label: e.label } : {}),
        ...(e.color ? { color: e.color } : {}),
      }));

    return { nodes, edges };
  }

  // ── import ──────────────────────────────────────────────────────────────
  /** Pull a title + body back out of markdown produced by us or by Obsidian. */
  function splitHeading(md) {
    const lines = String(md || '').split('\n');
    const h = /^#{1,3}\s+(.*)$/.exec(lines[0] || '');
    if (!h) return { title: '', body: md || '' };
    let i = 1;
    while (i < lines.length && !lines[i].trim()) i++;
    return { title: h[1].trim(), body: lines.slice(i).join('\n') };
  }

  const TASK_LINE = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/;

  function canvasNodeToOurs(cn, z) {
    // our own export round-trips exactly
    if (cn.canvaslide && cn.canvaslide.type) {
      const n = { ...cn.canvaslide };
      n.id = cn.id; n.x = cn.x; n.y = cn.y; n.w = cn.width; n.h = cn.height; n.z = z;
      return n;
    }
    const base = { id: cn.id || U.uid('n'), x: cn.x, y: cn.y, w: cn.width, h: cn.height, z };

    if (cn.type === 'group') {
      return { ...base, type: 'group', label: cn.label || 'Section', color: colorOf(cn.color) || '#7c6cff' };
    }
    if (cn.type === 'link') {
      return { ...base, type: 'link', url: cn.url || '', title: '' };
    }
    if (cn.type === 'file') {
      const f = String(cn.file || '');
      if (/\.(png|jpe?g|gif|webp|svg)$/i.test(f)) {
        return { ...base, type: 'image', src: f };   // vault-relative
      }
      return { ...base, type: 'note', title: f.split('/').pop(), body: `Linked file: \`${f}\`` };
    }

    // text node — recover a checklist if that's what it looks like
    const text = cn.text || '';
    const lines = text.split('\n');
    const taskLines = lines.filter(l => TASK_LINE.test(l));
    if (taskLines.length >= 2 && taskLines.length >= lines.filter(l => l.trim()).length - 1) {
      const { title } = splitHeading(text);
      return {
        ...base, type: 'todo', title: title || 'Checklist',
        items: taskLines.map(l => {
          const m = TASK_LINE.exec(l);
          return { id: U.uid('i'), text: m[2], done: m[1].toLowerCase() === 'x' };
        }),
      };
    }
    // short and colourful reads as a sticky, otherwise it's a note
    const colour = colorOf(cn.color);
    if (colour && text.length < 180 && !text.includes('#')) {
      return { ...base, type: 'sticky', text, color: colour };
    }
    const { title, body } = splitHeading(text);
    return { ...base, type: 'note', title, body: title ? body : text };
  }

  // our nine mounts → the spec's four sides
  const SIDE = {
    n: 'top', s: 'bottom', w: 'left', e: 'right',
    nw: 'top', ne: 'top', sw: 'bottom', se: 'bottom',
  };
  const ANCHOR_OF = { top: 'n', bottom: 's', left: 'w', right: 'e' };

  // spec presets 1–6 → our palette
  const PRESET = { '1': '#ff7a8a', '2': '#ffb37a', '3': '#ffd868', '4': '#8ee6b8', '5': '#8fd3ff', '6': '#c9a7ff' };
  const colorOf = (c) => !c ? null : (PRESET[String(c)] || (String(c).startsWith('#') ? String(c) : null));

  function canvasToDoc(canvas, name) {
    const doc = store.blankDoc(name || 'Imported canvas');
    doc.nodes = (canvas.nodes || []).map((cn, i) => canvasNodeToOurs(cn, i + 1));
    doc.edges = (canvas.edges || []).map(e => {
      const start = e.fromEnd === 'arrow';
      const end = e.toEnd !== 'none';
      return {
        id: e.id || U.uid('e'),
        from: e.fromNode, to: e.toNode, fromPt: null, toPt: null,
        fromAnchor: ANCHOR_OF[e.fromSide] || null,
        toAnchor: ANCHOR_OF[e.toSide] || null,
        label: e.label || '',
        style: 'curve',
        heads: start && end ? 'both' : start ? 'start' : end ? 'end' : 'none',
        color: colorOf(e.color),
      };
    });
    return doc;
  }

  // ── commands ────────────────────────────────────────────────────────────
  async function exportCurrent() {
    const doc = store.doc();
    if (!doc) return;
    const canvas = docToCanvas(doc);
    const ok = await window.api.exportText({
      name: `${doc.name}.canvas`,
      text: JSON.stringify(canvas, null, 2),
      filters: [{ name: 'JSON Canvas', extensions: ['canvas'] }],
    });
    if (ok) App.app.toast('Exported — drop it into an Obsidian vault to open it there');
  }

  async function importFile() {
    const picked = await window.api.importText({
      filters: [{ name: 'Canvas', extensions: ['canvas', 'json'] }],
    });
    if (!picked) return;
    let parsed;
    try { parsed = JSON.parse(picked.text); }
    catch (e) { return App.app.toast('That file is not valid JSON'); }
    if (!parsed.nodes) return App.app.toast('No nodes in that canvas file');

    const doc = canvasToDoc(parsed, picked.name.replace(/\.(canvas|json)$/i, ''));
    await window.api.writePage(doc);
    await store.refreshIndex();
    await store.openPage(doc.id);
    App.canvas.zoomToFit();
    App.app.toast(`Imported ${doc.nodes.length} items`);
  }

  /** Flatten a page to markdown, reading order top-to-bottom. */
  async function exportMarkdown() {
    const doc = store.doc();
    if (!doc) return;
    const parts = [`# ${doc.name}\n`];
    const ordered = [...doc.nodes]
      .filter(n => !['ink', 'group'].includes(n.type))
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    for (const n of ordered) {
      const md = toMarkdown(n).trim();
      if (md) parts.push(md + '\n');
    }
    if (doc.comments && doc.comments.length) {
      parts.push('\n---\n\n## Comments\n');
      for (const c of doc.comments) {
        for (const m of c.messages) parts.push(`- **${m.author}**: ${m.text}`);
      }
    }
    const ok = await window.api.exportText({
      name: `${doc.name}.md`,
      text: parts.join('\n'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (ok) App.app.toast('Exported markdown');
  }

  return { docToCanvas, canvasToDoc, exportCurrent, importFile, exportMarkdown, toMarkdown };
})();
