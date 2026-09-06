'use strict';
// Loads the renderer's plain-script modules into a jsdom window so the pure
// parts (markdown, JSON Canvas) can be tested without Electron.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

function load(files, { pages = [] } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
  const win = dom.window;
  const store = { __proto__: null };
  const ctx = vm.createContext(win);
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', f), 'utf8');
    vm.runInContext(src, ctx, { filename: f });
  }
  const App = win.App;
  if (App.store) {
    App.store.state.pages = pages.map((name, i) => ({ id: 'p' + i, name, folder: '', updated: 0, nodeCount: 0 }));
    App.store.state.vaultPath = '/vault';
  }
  return { App, window: win, document: win.document };
}

module.exports = { load };
