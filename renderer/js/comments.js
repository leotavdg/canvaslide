'use strict';
/* ===========================================================================
   comments.js — pins on the canvas + threaded replies.

   A comment either floats at a world point or rides along with a node
   (nodeId + dx/dy offset), so moving a note takes its comments with it.
   =========================================================================== */
App.comments = (() => {
  const U = App.util;
  const store = App.store;

  let layer, panel;
  let openId = null;

  const AUTHOR = 'You';

  function posOf(c) {
    if (c.nodeId) {
      const n = store.nodeById(c.nodeId);
      if (n) return { x: n.x + (c.dx || 0), y: n.y + (c.dy || 0) };
    }
    return { x: c.x, y: c.y };
  }

  function createAt(w, nodeId) {
    const c = {
      id: U.uid('c'),
      x: Math.round(w.x), y: Math.round(w.y),
      nodeId: nodeId || null,
      resolved: false,
      messages: [],
    };
    if (nodeId) {
      const n = store.nodeById(nodeId);
      if (n) { c.dx = Math.round(w.x - n.x); c.dy = Math.round(w.y - n.y); }
    }
    store.beginChange('comment');
    store.doc().comments.push(c);
    store.commit({ full: true });
    open(c.id, { compose: true });
  }

  function renderPins(d) {
    const z = d.camera.z;
    const seen = new Set();
    for (const c of d.comments) {
      seen.add(c.id);
      let el = layer.querySelector(`[data-cid="${c.id}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'pin';
        el.dataset.cid = c.id;
        el.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
        el.addEventListener('click', (e) => { e.stopPropagation(); open(c.id); });
        layer.appendChild(el);
      }
      const p = posOf(c);
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      el.style.transform = `scale(${1 / z})`;
      el.style.zIndex = String(9000);
      el.classList.toggle('resolved', !!c.resolved);
      const n = c.messages.length;
      el.textContent = n > 1 ? String(n) : '💬';
      el.title = c.messages[0] ? c.messages[0].text.slice(0, 80) : 'New comment';
    }
    for (const el of [...layer.children]) {
      if (!seen.has(el.dataset.cid)) el.remove();
    }
    if (openId) positionPanel();
  }

  function byId(id) { return store.doc().comments.find(c => c.id === id); }

  function open(id, opts = {}) {
    const c = byId(id);
    if (!c) return;
    openId = id;
    panel.classList.remove('hidden');
    panel.innerHTML = `
      ${c.messages.map(m => `
        <div class="th-msg">
          <div class="th-meta">${U.esc(m.author)} · ${U.timeAgo(m.ts)}</div>
          <div class="th-text">${App.md.inline(m.text)}</div>
        </div>`).join('')}
      <textarea class="th-input" rows="2" placeholder="${c.messages.length ? 'Reply…' : 'Add a comment…'}"></textarea>
      <div class="th-actions">
        <button class="btn-sm" data-a="delete">Delete</button>
        <button class="btn-sm" data-a="resolve">${c.resolved ? 'Reopen' : 'Resolve'}</button>
        <button class="btn-sm primary" data-a="send">Send</button>
      </div>`;

    const input = panel.querySelector('.th-input');
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.metaKey || !e.shiftKey)) { e.preventDefault(); send(); }
      if (e.key === 'Escape') close();
    });
    panel.querySelectorAll('[data-a]').forEach(b => {
      b.addEventListener('click', () => {
        const a = b.dataset.a;
        if (a === 'send') send();
        if (a === 'resolve') { store.beginChange('comment'); c.resolved = !c.resolved; store.commit({ full: true }); close(); }
        if (a === 'delete') {
          store.beginChange('comment');
          store.doc().comments = store.doc().comments.filter(x => x.id !== id);
          store.commit({ full: true });
          close();
        }
      });
    });

    function send() {
      const text = input.value.trim();
      if (!text) { if (!c.messages.length) return; close(); return; }
      store.beginChange('comment');
      c.messages.push({ id: U.uid('m'), author: AUTHOR, text, ts: Date.now() });
      store.commit({ full: true });
      open(id);
      panel.querySelector('.th-input').focus();
    }

    positionPanel();
    if (opts.compose !== false) setTimeout(() => input.focus(), 10);
  }

  function positionPanel() {
    const c = byId(openId);
    if (!c) return close();
    const p = App.canvas.toScreen(posOf(c));
    const rect = App.canvas.viewportEl.getBoundingClientRect();
    const w = 292, h = panel.offsetHeight || 160;
    let x = rect.left + p.x + 20;
    let y = rect.top + p.y - 10;
    x = U.clamp(x, 12, window.innerWidth - w - 12);
    y = U.clamp(y, 60, window.innerHeight - h - 20);
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  }

  function close() {
    openId = null;
    panel.classList.add('hidden');
    // A pin with no messages was abandoned mid-compose — clean it up.
    const d = store.doc();
    if (d) {
      const before = d.comments.length;
      d.comments = d.comments.filter(c => c.messages.length || c.resolved);
      if (d.comments.length !== before) store.commit({ full: true });
    }
  }

  function mount() {
    layer = document.getElementById('layer-pins');
    panel = document.getElementById('thread');
    document.addEventListener('pointerdown', (e) => {
      if (!openId) return;
      if (panel.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.pin')) return;
      close();
    }, true);
  }

  return { mount, renderPins, createAt, open, close, posOf };
})();
