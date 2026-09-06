'use strict';
/* Small line-oriented markdown renderer.
   Deliberately tiny — no dependency, and it only needs to cover what a note
   card realistically holds. [[wikilinks]] are first-class. */
App.md = (() => {
  const esc = App.util.esc;

  /* ── rendered HTML → markdown ────────────────────────────────────────────
     The inverse of render(), for exactly the constructs render() emits. It
     exists so a note can be edited *as it looks* — the table stays a table
     while you type in it — instead of being swapped for its own source, which
     reflowed the card every time you clicked into it. */
  function toMarkdown(root) {
    const lines = [];

    const inlineOf = (node) => {
      let out = '';
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { out += n.nodeValue.replace(/\u00a0/g, ' '); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toLowerCase();
        const kids = () => inlineOf(n);
        if (tag === 'br') out += '\n';
        else if (tag === 'strong' || tag === 'b') out += `**${kids()}**`;
        else if (tag === 'em' || tag === 'i') out += `*${kids()}*`;
        else if (tag === 's' || tag === 'del') out += `~~${kids()}~~`;
        else if (tag === 'mark') out += `==${kids()}==`;
        else if (tag === 'code') out += '`' + n.textContent + '`';
        else if (tag === 'a') out += `[${kids()}](${n.getAttribute('href') || ''})`;
        else if (n.classList.contains('wikilink')) {
          const page = n.dataset.link || n.textContent;
          const shown = n.textContent;
          out += shown && shown !== page ? `[[${page}|${shown}]]` : `[[${page}]]`;
        } else if (n.classList.contains('tag-inline')) out += n.textContent;
        else if (n.classList.contains('md-check')) out += '';       // handled by the li
        else out += kids();
      }
      return out;
    };

    const block = (el) => {
      if (el.nodeType === 3) {
        const t = el.nodeValue.trim();
        if (t) lines.push(t);
        return;
      }
      if (el.nodeType !== 1) return;
      const tag = el.tagName.toLowerCase();

      if (/^h[1-6]$/.test(tag)) {
        lines.push('#'.repeat(Math.min(3, +tag[1])) + ' ' + inlineOf(el), '');
      } else if (tag === 'hr') {
        lines.push('---', '');
      } else if (el.classList.contains('md-callout')) {
        const kind = [...el.classList].map(c => /^md-(\w+)$/.exec(c)).find(m => m && m[1] !== 'callout');
        const body = el.querySelector('div');
        lines.push(`> [!${kind ? kind[1] : 'note'}] ${body ? inlineOf(body) : ''}`, '');
      } else if (tag === 'blockquote') {
        lines.push('> ' + inlineOf(el), '');
      } else if (tag === 'table') {
        const rows = [...el.querySelectorAll('tr')];
        rows.forEach((tr, i) => {
          const cells = [...tr.children].map(td => inlineOf(td).trim());
          lines.push(`| ${cells.join(' | ')} |`);
          if (i === 0) lines.push(`|${cells.map(() => '---').join('|')}|`);
        });
        lines.push('');
      } else if (tag === 'ul' || tag === 'ol') {
        [...el.children].forEach((li, i) => {
          const check = li.querySelector('.md-check');
          const text = inlineOf(li).trim();
          if (check) lines.push(`- [${check.textContent.trim() === '☑' ? 'x' : ' '}] ${text}`);
          else lines.push(tag === 'ol' ? `${i + 1}. ${text}` : `- ${text}`);
        });
        lines.push('');
      } else if (tag === 'pre') {
        lines.push('```', el.textContent.replace(/\n$/, ''), '```', '');
      } else if (tag === 'br') {
        lines.push('');
      } else {
        // <p>, and the <div>s contenteditable makes when you press Enter
        const t = inlineOf(el);
        lines.push(t.trim() ? t : '');
      }
    };

    for (const child of root.childNodes) block(child);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
    // [[Page]] and [[Page|alias]]
    s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, page, alias) => {
      const name = page.trim();
      const known = App.store.pageExists(name);
      return `<span class="wikilink${known ? '' : ' missing'}" data-link="${esc(name)}">${esc(alias || name)}</span>`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|\W)_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');
    s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    // #tags become clickable chips
    s = s.replace(/(^|[\s(])#([a-z0-9][\w/-]{0,40})/gi,
      (_m, pre, tag) => `${pre}<span class="tag-inline" data-tag="${esc(tag.toLowerCase())}">#${esc(tag)}</span>`);
    return s;
  }

  function render(src) {
    const lines = String(src || '').split('\n');
    const out = [];
    let list = null, inCode = false, code = [];

    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');

      if (/^```/.test(line)) {
        if (inCode) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = []; inCode = false; }
        else { closeList(); inCode = true; }
        continue;
      }
      if (inCode) { code.push(raw); continue; }

      if (!line.trim()) { closeList(); continue; }

      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { closeList(); out.push('<hr>'); continue; }

      // callout: > [!note] Title
      const call = /^>\s*\[!(\w+)\]\s*(.*)$/.exec(line);
      if (call) {
        closeList();
        const kind = call[1].toLowerCase();
        const icon = { note: 'ℹ️', tip: '💡', warning: '⚠️', danger: '🔥', todo: '☑', quote: '❝' }[kind] || 'ℹ️';
        out.push(`<div class="md-callout md-${esc(kind)}"><span>${icon}</span><div>${inline(call[2] || kind)}</div></div>`);
        continue;
      }

      const q = /^>\s?(.*)$/.exec(line);
      if (q) { closeList(); out.push(`<blockquote>${inline(q[1])}</blockquote>`); continue; }

      // markdown table
      if (/^\s*\|.*\|\s*$/.test(line)) {
        closeList();
        const cells = line.trim().slice(1, -1).split('|').map(c => c.trim());
        if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;   // the --- separator row
        const prev = out[out.length - 1] || '';
        const row = `<tr>${cells.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`;
        if (prev.endsWith('</table>')) out[out.length - 1] = prev.slice(0, -8) + row + '</table>';
        else out.push(`<table class="md-table">${row}</table>`);
        continue;
      }

      // inline task syntax inside a note body
      const task = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (task) {
        if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
        const on = task[1].toLowerCase() === 'x';
        out.push(`<li><span class="md-check">${on ? '☑' : '☐'}</span>${on ? '<s>' : ''}${inline(task[2])}${on ? '</s>' : ''}</li>`);
        continue;
      }

      const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
      if (ul) {
        if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
        out.push(`<li>${inline(ul[1])}</li>`); continue;
      }

      const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (ol) {
        if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
        out.push(`<li>${inline(ol[1])}</li>`); continue;
      }

      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
    if (inCode && code.length) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    closeList();
    return out.join('');
  }

  /** Every [[link]] target inside a string. */
  function links(src) {
    const found = [];
    const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let m;
    while ((m = re.exec(String(src || '')))) found.push(m[1].trim());
    return found;
  }

  return { render, links, inline, toMarkdown };
})();
