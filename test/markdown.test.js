'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');

const { App, document } = load(['util.js', 'markdown.js', 'store.js'], { pages: ['Welcome', 'Tom & Jerry'] });
const md = App.md;

const roundTrip = (src) => {
  const div = document.createElement('div');
  div.innerHTML = md.render(src);
  return md.toMarkdown(div).trim();
};

test('finished tasks do not gain ~~ on each round trip', () => {
  const src = '- [ ] one\n- [x] two';
  let s = src;
  for (let i = 0; i < 3; i++) s = roundTrip(s);
  assert.equal(s, src);
});

test('struck text outside a task survives as ~~', () => {
  assert.equal(roundTrip('some ~~old~~ text'), 'some ~~old~~ text');
});

test('wikilinks with & resolve and escape once', () => {
  const html = md.inline('see [[Tom & Jerry]]');
  assert.match(html, /class="wikilink"/);
  assert.doesNotMatch(html, /missing/);
  assert.match(html, /data-link="Tom &amp; Jerry"/);
  assert.match(html, />Tom &amp; Jerry</);
  assert.doesNotMatch(html, /&amp;amp;/);
});

test('unknown pages are marked missing, aliases are shown', () => {
  const html = md.inline('[[Nowhere|alias]]');
  assert.match(html, /wikilink missing/);
  assert.match(html, />alias</);
});

test('wikilink round trip keeps the alias', () => {
  assert.equal(roundTrip('go to [[Welcome|home]] now'), 'go to [[Welcome|home]] now');
});

test('code spans are not formatted or escaped twice', () => {
  const html = md.inline('use `a < b && **x**` here');
  assert.match(html, /<code>a &lt; b &amp;&amp; \*\*x\*\*<\/code>/);
});

test('inline formatting', () => {
  assert.equal(md.inline('**b** *i* ~~s~~ ==m=='), '<strong>b</strong> <em>i</em> <s>s</s> <mark>m</mark>');
  assert.equal(md.inline('2*3*4'), '2*3*4');
});

test('blocks round trip', () => {
  const src = ['# Title', '', 'Para with [site](https://example.com) and #tag', '', '> [!tip] Remember', '',
    '| a | b |', '| --- | --- |', '| 1 | 2 |', '', '1. first', '2. second', '', '```', 'code < here', '```'].join('\n');
  assert.equal(roundTrip(src), src);
});

test('links() finds targets', () => {
  assert.deepEqual([...md.links('[[A]] and [[B|c]] and [[ D ]]')], ['A', 'B', 'D']);
});

test('external links open in a new target', () => {
  assert.match(md.inline('[x](https://e.com)'), /<a href="https:\/\/e.com" target="_blank" rel="noopener">x<\/a>/);
});
