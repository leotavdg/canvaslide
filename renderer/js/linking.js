'use strict';
/* ===========================================================================
   linking.js — the Obsidian half of the app's plumbing.

   * [[ autocomplete while typing — the single interaction people name most
     often when they explain why linking in Obsidian feels effortless.
   * daily notes
   * page-embed cards (a card on the canvas that mirrors another page)
   =========================================================================== */

// ── [[ ]] autocompletion ───────────────────────────────────────────────────
App.suggest = (() => {
  const U = App.util;
  const store = App.store;

  let el;                 // popup
  let ctx = null;         // {textNode, start, query}
  let items = [], idx = 0;

  /** Look backwards from the caret for an unclosed "[[". */
  function contextAtCaret() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    if (!node.parentElement || !node.parentElement.closest('[contenteditable="true"]')) return null;

    const before = node.data.slice(0, sel.anchorOffset);
    const open = before.lastIndexOf('[[');
    if (open < 0) return null;
    const query = before.slice(open + 2);
    if (query.includes(']') || query.includes('[') || query.includes('\n')) return null;
    if (query.length > 60) return null;
    return { textNode: node, start: open, end: sel.anchorOffset, query };
  }

  function refresh() {
    const q = ctx.query;
    const scored = store.state.pages
      .map(p => ({ p, s: App.commands.fuzzy(q, p.name) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8);

    items = scored.map(x => ({ kind: 'page', name: x.p.name }));
    if (q.trim() && !store.pageExists(q.trim())) {
      items.push({ kind: 'new', name: q.trim() });
    }
    if (!items.length) return hide();

    idx = U.clamp(idx, 0, items.length - 1);
    el.innerHTML = items.map((it, i) => `
      <div class="sg-item${i === idx ? ' on' : ''}" data-i="${i}">
        <span>${it.kind === 'new' ? '＋ ' : '📄 '}${U.esc(it.name)}</span>
        ${it.kind === 'new' ? '<span class="sg-hint">create</span>' : ''}
      </div>`).join('');
    el.querySelectorAll('[data-i]').forEach(d => {
      d.addEventListener('mousedown', (e) => { e.preventDefault(); accept(+d.dataset.i); });
    });
    position();
    el.classList.remove('hidden');
  }

  function position() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0).cloneRange();
    let rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height && !rect.top)) {
      const host = sel.anchorNode.parentElement;
      rect = host.getBoundingClientRect();
    }
    const w = 240, h = el.offsetHeight || 160;
    let x = U.clamp(rect.left, 10, window.innerWidth - w - 10);
    let y = rect.bottom + 6;
    if (y + h > window.innerHeight - 10) y = rect.top - h - 6;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  /** Replace "[[query" with a finished "[[Page]]" and put the caret after it. */
  function accept(i) {
    const it = items[i];
    if (!it || !ctx) return hide();
    const { textNode, start, end } = ctx;
    const insert = `[[${it.name}]]`;
    const data = textNode.data;
    textNode.data = data.slice(0, start) + insert + data.slice(end);

    const range = document.createRange();
    const caret = start + insert.length;
    range.setStart(textNode, Math.min(caret, textNode.data.length));
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    hide();
    // push the edited text back into the model
    const host = textNode.parentElement.closest('[contenteditable="true"]');
    if (host) host.dispatchEvent(new Event('input', { bubbles: true }));
    if (it.kind === 'new') store.newPage(it.name, { open: false });
  }

  function hide() { ctx = null; items = []; el.classList.add('hidden'); }
  const visible = () => !el.classList.contains('hidden');

  /** Called from the shared keydown handler before anything else sees the key. */
  function onKeyDown(e) {
    if (!visible()) return false;
    if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, items.length - 1); refresh(); e.preventDefault(); return true; }
    if (e.key === 'ArrowUp')   { idx = Math.max(idx - 1, 0); refresh(); e.preventDefault(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { accept(idx); e.preventDefault(); return true; }
    if (e.key === 'Escape') { hide(); e.preventDefault(); return true; }
    return false;
  }

  function onInput() {
    const c = contextAtCaret();
    if (!c) return hide();
    const fresh = !ctx || ctx.start !== c.start;
    ctx = c;
    if (fresh) idx = 0;
    refresh();
  }

  function mount() {
    el = document.getElementById('suggest');
    document.addEventListener('selectionchange', () => { if (visible()) onInput(); });
  }

  return { mount, onInput, onKeyDown, hide, visible };
})();

// ── daily notes ────────────────────────────────────────────────────────────
App.daily = (() => {
  const store = App.store;

  const stamp = (d = new Date()) => {
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  async function open(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const name = stamp(d);
    const existing = store.pageByName(name);
    if (existing) return store.openPage(existing.id);

    const page = store.blankDoc(name);
    const long = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    page.nodes.push({
      ...App.nodes.create('note', 80, 80, {
        title: long,
        body: 'What happened today?\n\n- ',
      }), z: 1,
    });
    page.nodes.push({
      ...App.nodes.create('todo', 460, 80, {
        title: 'Today',
        items: [{ id: 'i' + Date.now().toString(36), text: '', done: false }],
      }), z: 2,
    });
    await window.api.writePage(page);
    await store.refreshIndex();
    await store.openPage(page.id);
  }

  return { open, stamp };
})();

// ── page embeds ────────────────────────────────────────────────────────────
App.embed = (() => {
  const store = App.store;

  /** Ask which page, then drop a live card for it on the canvas. */
  function pickPage() {
    App.commands.open({
      mode: 'page',
      placeholder: 'Embed which page?',
      onPick: (page) => {
        const d = App.nodes.DEFAULTS.embed;
        const p = App.commands.placeFor(d.w, d.h);
        const n = App.nodes.create('embed', p.x, p.y, { pageId: page.id, pageName: page.name });
        store.addNode(n);
        App.canvas.ensureVisible(n);
      },
    });
  }

  return { pickPage };
})();

// ── "/" slash menu inside text ─────────────────────────────────────────────
/* Notion's most-copied interaction: type "/" on an empty line, pick a block.
   Same caret machinery as the [[ ]] suggester, different payload. */
App.slash = (() => {
  const U = App.util;

  const SNIPPETS = [
    { title: 'Heading 1',      icon: 'H1', text: '# ' },
    { title: 'Heading 2',      icon: 'H2', text: '## ' },
    { title: 'Heading 3',      icon: 'H3', text: '### ' },
    { title: 'Bulleted list',  icon: '•',  text: '- ' },
    { title: 'Numbered list',  icon: '1.', text: '1. ' },
    { title: 'To-do',          icon: '☐',  text: '- [ ] ' },
    { title: 'Quote',          icon: '❝',  text: '> ' },
    { title: 'Callout',        icon: 'ℹ️', text: '> [!note] ' },
    { title: 'Warning',        icon: '⚠️', text: '> [!warning] ' },
    { title: 'Tip',            icon: '💡', text: '> [!tip] ' },
    { title: 'Code block',     icon: '{}', text: '```\n\n```', caret: 4 },
    { title: 'Divider',        icon: '—',  text: '---\n' },
    { title: 'Table',          icon: '▦',  text: '| Column | Column |\n| --- | --- |\n|  |  |\n' },
    { title: 'Link to page',   icon: '🔗', text: '[[' },
    { title: 'Bold',           icon: 'B',  text: '****', caret: 2 },
    { title: 'Tag',            icon: '#',  text: '#' },
  ];

  let el, ctx = null, items = [], idx = 0;

  /** "/" must start a line or follow whitespace — otherwise it's just a slash. */
  function contextAtCaret() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    if (!node.parentElement || !node.parentElement.closest('[contenteditable="true"]')) return null;

    const before = node.data.slice(0, sel.anchorOffset);
    const at = before.lastIndexOf('/');
    if (at < 0) return null;
    const prev = at === 0 ? '' : before[at - 1];
    if (prev && !/\s/.test(prev)) return null;
    const query = before.slice(at + 1);
    if (/[\s\/]/.test(query) || query.length > 22) return null;
    return { textNode: node, start: at, end: sel.anchorOffset, query };
  }

  function refresh() {
    const q = ctx.query;
    items = q
      ? SNIPPETS.map(s => ({ s, v: App.commands.fuzzy(q, s.title) }))
          .filter(x => x.v >= 0).sort((a, b) => b.v - a.v).map(x => x.s)
      : SNIPPETS;
    if (!items.length) return hide();
    idx = U.clamp(idx, 0, items.length - 1);
    el.innerHTML = items.map((it, i) => `
      <div class="sg-item${i === idx ? ' on' : ''}" data-i="${i}">
        <span><span class="sw-ico">${U.esc(it.icon)}</span>${U.esc(it.title)}</span>
      </div>`).join('');
    el.querySelectorAll('[data-i]').forEach(d =>
      d.addEventListener('mousedown', (e) => { e.preventDefault(); accept(+d.dataset.i); }));
    position();
    el.classList.remove('hidden');
  }

  function position() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    let rect = sel.getRangeAt(0).cloneRange().getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height && !rect.top)) {
      rect = sel.anchorNode.parentElement.getBoundingClientRect();
    }
    const h = el.offsetHeight || 200;
    el.style.left = U.clamp(rect.left, 10, window.innerWidth - 250) + 'px';
    el.style.top = (rect.bottom + h > window.innerHeight - 10 ? rect.top - h - 6 : rect.bottom + 6) + 'px';
  }

  function accept(i) {
    const it = items[i];
    if (!it || !ctx) return hide();
    const { textNode, start, end } = ctx;
    const data = textNode.data;
    textNode.data = data.slice(0, start) + it.text + data.slice(end);

    const caret = start + (it.caret != null ? it.caret : it.text.length);
    const range = document.createRange();
    range.setStart(textNode, Math.min(caret, textNode.data.length));
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    hide();
    const host = textNode.parentElement.closest('[contenteditable="true"]');
    if (host) host.dispatchEvent(new Event('input', { bubbles: true }));
    if (it.text === '[[') App.suggest.onInput();
  }

  function hide() { ctx = null; items = []; el.classList.add('hidden'); }
  const visible = () => !el.classList.contains('hidden');

  function onKeyDown(e) {
    if (!visible()) return false;
    if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, items.length - 1); refresh(); e.preventDefault(); return true; }
    if (e.key === 'ArrowUp')   { idx = Math.max(idx - 1, 0); refresh(); e.preventDefault(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { accept(idx); e.preventDefault(); return true; }
    if (e.key === 'Escape') { hide(); e.preventDefault(); return true; }
    return false;
  }

  function onInput() {
    const c = contextAtCaret();
    if (!c) return hide();
    const fresh = !ctx || ctx.start !== c.start;
    ctx = c;
    if (fresh) idx = 0;
    refresh();
  }

  function mount() { el = document.getElementById('slashmenu'); }

  return { mount, onInput, onKeyDown, hide, visible };
})();
