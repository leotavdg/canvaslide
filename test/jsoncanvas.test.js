'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');

const { App } = load(['util.js', 'markdown.js', 'store.js', 'jsoncanvas.js'], { pages: ['Welcome'] });
const jc = App.jsoncanvas;

test('our export round-trips losslessly', () => {
  const doc = App.store.blankDoc('Test');
  doc.nodes.push({ id: 'n1', type: 'note', x: 0, y: 0, w: 300, h: 200, z: 1, title: 'Hi', body: 'body [[Welcome]]' });
  doc.nodes.push({ id: 'n2', type: 'todo', x: 400, y: 0, w: 300, h: 200, z: 2, title: 'T', items: [{ id: 'i1', text: 'a', done: true }] });
  doc.nodes.push({ id: 'n3', type: 'image', x: 0, y: 300, w: 100, h: 100, z: 3, src: 'assets/pic.png' });
  doc.edges.push({ id: 'e1', from: 'n1', to: 'n2', fromPt: null, toPt: null, fromAnchor: 'e', toAnchor: null, label: 'L', style: 'curve', heads: 'both', color: null });
  const canvas = jc.docToCanvas(doc);
  assert.equal(canvas.nodes.length, 3);
  assert.equal(canvas.nodes.find(n => n.id === 'n3').file, 'assets/pic.png');
  assert.equal(canvas.edges[0].fromSide, 'right');
  const back = jc.canvasToDoc(canvas, 'Test');
  assert.deepEqual([...back.nodes.map(n => n.type)], ['note', 'todo', 'image']);
  assert.equal(back.nodes[1].items[0].done, true);
  assert.equal(back.nodes[2].src, 'assets/pic.png');
  assert.equal(back.edges[0].heads, 'both');
});

test('an Obsidian-authored canvas imports sensibly', () => {
  const canvas = {
    nodes: [
      { id: 'a', type: 'text', x: 0, y: 0, width: 250, height: 60, text: '# Plan\n\n- [ ] one\n- [x] two' },
      { id: 'b', type: 'text', x: 300, y: 0, width: 250, height: 60, text: 'Short idea', color: '3' },
      { id: 'c', type: 'group', x: -20, y: -20, width: 600, height: 200, label: 'Sprint' },
      { id: 'd', type: 'file', x: 0, y: 300, width: 200, height: 200, file: 'assets/photo.jpg' },
      { id: 'e', type: 'link', x: 0, y: 600, width: 200, height: 100, url: 'https://obsidian.md' },
    ],
    edges: [{ id: 'x', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left', toEnd: 'arrow' }],
  };
  const doc = jc.canvasToDoc(canvas, 'Imported');
  const types = Object.fromEntries(doc.nodes.map(n => [n.id, n.type]));
  assert.deepEqual(types, { a: 'todo', b: 'sticky', c: 'group', d: 'image', e: 'link' });
  assert.equal(doc.nodes[0].items.length, 2);
  assert.equal(doc.nodes[1].color, '#ffd868');
  assert.equal(doc.nodes[3].src, 'assets/photo.jpg');
  assert.equal(doc.edges[0].fromAnchor, 'e');
  assert.equal(doc.edges[0].heads, 'end');
});

test('markdown export flattens in reading order', () => {
  const doc = App.store.blankDoc('T');
  doc.nodes.push({ id: 'b', type: 'sticky', x: 0, y: 200, w: 100, h: 100, text: 'second' });
  doc.nodes.push({ id: 'a', type: 'note', x: 0, y: 0, w: 100, h: 100, title: 'First', body: 'x' });
  const md = doc.nodes.slice().sort((p, q) => p.y - q.y).map(jc.toMarkdown).join('\n');
  assert.equal(md, '# First\n\nx\nsecond');
});
