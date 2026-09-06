'use strict';
const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fssync = require('fs');

// ---------------------------------------------------------------------------
// Vault: a plain folder of .canvaslide.json files, one per page. Obsidian-ish:
// the user owns the files, we just read/write them.
// ---------------------------------------------------------------------------
// Where the vault lives is a real preference, not a per-launch accident:
// choosing a folder (an iCloud/Dropbox one, say) has to survive a restart.
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try { return JSON.parse(fssync.readFileSync(SETTINGS(), 'utf8')); }
  catch (e) { return {}; }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try {
    fssync.mkdirSync(path.dirname(SETTINGS()), { recursive: true });
    fssync.writeFileSync(SETTINGS(), JSON.stringify(next, null, 2), 'utf8');
  } catch (e) { console.warn('could not save settings:', e.message); }
  return next;
}

let VAULT = loadSettings().vault || path.join(app.getPath('documents'), 'CanvasLide');

let vaultFellBack = false;

const TRASH = '.trash';

/** Create the vault, falling back to app-support if Documents is off limits
 *  (macOS privacy prompt declined) so the app never dead-ends. */
function ensureVault() {
  try {
    if (!fssync.existsSync(VAULT)) fssync.mkdirSync(VAULT, { recursive: true });
    fssync.accessSync(VAULT, fssync.constants.R_OK | fssync.constants.W_OK);
  } catch (e) {
    const fallback = path.join(app.getPath('userData'), 'Vault');
    if (VAULT !== fallback) {
      console.warn(`Vault unavailable at ${VAULT} (${e.code}); using ${fallback}`);
      VAULT = fallback;
      vaultFellBack = true;
      fssync.mkdirSync(VAULT, { recursive: true });
    }
  }
  const assets = path.join(VAULT, 'assets');
  if (!fssync.existsSync(assets)) fssync.mkdirSync(assets, { recursive: true });
  return VAULT;
}

// Pages live in real subdirectories, so the folder tree in the sidebar is the
// folder tree on disk — you can rearrange it in Finder and the app follows.
const pathById = new Map();

const safeFolder = (f) => String(f || '')
  .split('/')
  .map(seg => seg.replace(/[<>:"\\|?*\u0000-\u001f]/g, '').trim())
  .filter(seg => seg && seg !== '.' && seg !== '..')
  .join('/');

function pageFile(id, folder) {
  if (folder != null) return path.join(VAULT, safeFolder(folder), `${id}.canvaslide.json`);
  return pathById.get(id) || path.join(VAULT, `${id}.canvaslide.json`);
}

/** Every .canvaslide.json under the vault, with its folder relative to root. */
function walk(dir, rel = '') {
  let entries = [];
  try { entries = fssync.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
  const out = [];
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name === 'assets') continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(abs, rel ? `${rel}/${ent.name}` : ent.name));
    else if (ent.name.endsWith('.canvaslide.json')) out.push({ abs, folder: rel, file: ent.name });
  }
  return out;
}

/** Folders in the vault, including empty ones (which are still meaningful). */
function allFolders(dir = VAULT, rel = '') {
  let entries = [];
  try { entries = fssync.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.') || ent.name === 'assets') continue;
    const sub = rel ? `${rel}/${ent.name}` : ent.name;
    out.push(sub);
    out.push(...allFolders(path.join(dir, ent.name), sub));
  }
  return out.sort();
}

const summary = (doc, folder) => ({
  id: doc.id, name: doc.name || 'Untitled', folder,
  updated: doc.updated || 0,
  nodeCount: (doc.nodes || []).length,
});

/** One pass over the vault serving the page list, the full-text index and the
 *  folder tree. */
async function readIndex() {
  ensureVault();
  pathById.clear();
  const pages = [];
  const docs = [];
  for (const { abs, folder, file } of walk(VAULT)) {
    try {
      const doc = JSON.parse(await fs.readFile(abs, 'utf8'));
      const id = doc.id || file.replace('.canvaslide.json', '');
      doc.id = id;
      doc.folder = folder;
      pathById.set(id, abs);
      docs.push(doc);
      pages.push(summary(doc, folder));
    } catch (e) {
      console.warn('skip unreadable page', file, e.message);
    }
  }
  pages.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return { pages, docs, folders: allFolders() };
}

// ── writing ────────────────────────────────────────────────────────────────
// Every write goes to a temp file first and is renamed over the original, so a
// crash mid-write can never leave a truncated page behind.
const ownWrites = new Map();   // abs path -> time of our last write (for the watcher)

function noteOwnWrite(abs) { ownWrites.set(abs, Date.now()); }

function writeDocSync(doc) {
  ensureVault();
  const target = pageFile(doc.id, doc.folder != null ? doc.folder : undefined);
  fssync.mkdirSync(path.dirname(target), { recursive: true });
  const prev = pathById.get(doc.id);
  const tmp = `${target}.${process.pid}.tmp`;
  noteOwnWrite(target);
  fssync.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
  fssync.renameSync(tmp, target);
  if (prev && prev !== target) { noteOwnWrite(prev); try { fssync.unlinkSync(prev); } catch (_) {} }
  pathById.set(doc.id, target);
  return target;
}

async function writeDoc(doc) {
  ensureVault();
  const target = pageFile(doc.id, doc.folder != null ? doc.folder : undefined);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const prev = pathById.get(doc.id);
  const tmp = `${target}.${process.pid}.tmp`;
  noteOwnWrite(target);
  await fs.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8');
  await fs.rename(tmp, target);
  if (prev && prev !== target) { noteOwnWrite(prev); await fs.unlink(prev).catch(() => {}); }
  pathById.set(doc.id, target);
  return target;
}

// ── watching ───────────────────────────────────────────────────────────────
// Someone else may write the vault: iCloud bringing edits from another Mac,
// Finder moving files, a text editor. Tell the renderer, but not about our own
// writes — those it already knows.
let watcher = null;
let watchTimer = null;
let watchQueue = new Set();

function startWatcher() {
  stopWatcher();
  try {
    watcher = fssync.watch(VAULT, { recursive: true }, (_evt, name) => {
      if (!name) return;
      const rel = String(name);
      const base = path.basename(rel);
      if (base.endsWith('.tmp') || base.startsWith('.')) return;
      if (rel.startsWith(TRASH) || rel.split(path.sep)[0] === TRASH) return;
      const abs = path.join(VAULT, rel);
      const own = ownWrites.get(abs);
      if (own && Date.now() - own < 2500) return;
      watchQueue.add(abs);
      clearTimeout(watchTimer);
      watchTimer = setTimeout(flushWatch, 400);
    });
    watcher.on('error', (e) => console.warn('vault watcher error:', e.message));
  } catch (e) {
    console.warn('could not watch vault:', e.message);
  }
}
function stopWatcher() {
  if (watcher) { try { watcher.close(); } catch (_) {} watcher = null; }
}
function flushWatch() {
  const paths = [...watchQueue];
  watchQueue = new Set();
  if (!win || !paths.length) return;
  // map changed files back to page ids where we can
  const ids = [];
  for (const abs of paths) {
    for (const [id, p] of pathById) if (p === abs) ids.push(id);
    if (abs.endsWith('.canvaslide.json') && !ids.length) {
      ids.push(path.basename(abs).replace('.canvaslide.json', ''));
    }
  }
  win.webContents.send('vault:external-change', { ids, paths });
}

function registerIpc() {
  ipcMain.handle('vault:index', () => readIndex());
  ipcMain.handle('vault:path', () => ensureVault());
  ipcMain.handle('vault:info', () => ({ path: ensureVault(), fellBack: vaultFellBack }));

  ipcMain.handle('page:read', async (_e, id) => {
    try {
      const abs = pageFile(id);
      const doc = JSON.parse(await fs.readFile(abs, 'utf8'));
      doc.folder = path.relative(VAULT, path.dirname(abs)).split(path.sep).filter(Boolean).join('/');
      return doc;
    } catch (e) { return null; }
  });

  ipcMain.handle('folder:list', () => allFolders());

  ipcMain.handle('folder:create', async (_e, name) => {
    const rel = safeFolder(name);
    if (!rel) return null;
    await fs.mkdir(path.join(VAULT, rel), { recursive: true });
    return rel;
  });

  ipcMain.handle('folder:rename', async (_e, { from, to }) => {
    const a = safeFolder(from), b = safeFolder(to);
    if (!a || !b || a === b) return false;
    try {
      await fs.rename(path.join(VAULT, a), path.join(VAULT, b));
      return true;
    } catch (e) { return false; }
  });

  /** Remove a folder, moving anything inside it back to the vault root. */
  ipcMain.handle('folder:delete', async (_e, name) => {
    const rel = safeFolder(name);
    if (!rel) return false;
    const dir = path.join(VAULT, rel);
    for (const { abs, file } of walk(dir)) {
      await fs.rename(abs, path.join(VAULT, file)).catch(() => {});
    }
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    return true;
  });

  ipcMain.handle('page:write', async (_e, doc) => {
    try { await writeDoc(doc); return true; }
    catch (e) { console.error('page:write failed:', e.message); return false; }
  });

  // The synchronous twin, used only while the window is closing: the renderer
  // blocks on it, so the write lands before the process can go away.
  ipcMain.on('page:writeSync', (e, doc) => {
    try { writeDocSync(doc); e.returnValue = true; }
    catch (err) { console.error('page:writeSync failed:', err.message); e.returnValue = false; }
  });

  /** Write a conflict copy next to the page (used when a sync brought in a
   *  version the user had also edited locally). */
  ipcMain.handle('page:writeConflict', async (_e, doc) => {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
    const copy = { ...doc, id: `${doc.id}-conflict-${Date.now().toString(36)}`, name: `${doc.name} (conflict ${stamp})` };
    try { await writeDoc(copy); return copy.id; }
    catch (e) { console.error('conflict copy failed:', e.message); return null; }
  });

  // Deleting moves the file into <vault>/.trash — the walker ignores dot
  // folders, so it vanishes from the app without being gone for good.
  ipcMain.handle('page:delete', async (_e, id) => {
    try {
      const abs = pageFile(id);
      const trash = path.join(VAULT, TRASH);
      await fs.mkdir(trash, { recursive: true });
      noteOwnWrite(abs);
      await fs.rename(abs, path.join(trash, path.basename(abs)));
      pathById.delete(id);
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('trash:count', async () => {
    try { return (await fs.readdir(path.join(VAULT, TRASH))).filter(f => f.endsWith('.canvaslide.json')).length; }
    catch (e) { return 0; }
  });
  ipcMain.handle('trash:empty', async () => {
    await fs.rm(path.join(VAULT, TRASH), { recursive: true, force: true }).catch(() => {});
    return true;
  });
  ipcMain.handle('trash:reveal', () => {
    const t = path.join(VAULT, TRASH);
    if (fssync.existsSync(t)) shell.openPath(t);
  });

  // Images are copied into the vault so pages stay portable. The path handed
  // back is vault-relative; the renderer resolves it against the vault.
  ipcMain.handle('asset:save', async (_e, { name, dataUrl }) => {
    ensureVault();
    const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl || '');
    if (!m) return null;
    const ext = ((m[1].split('/')[1] || 'png').split('+')[0]).replace(/[^a-z0-9]/gi, '');
    const file = `${Date.now().toString(36)}-${(name || 'img').replace(/[^\w.-]/g, '_')}.${ext}`;
    const abs = path.join(VAULT, 'assets', file);
    noteOwnWrite(abs);
    await fs.writeFile(abs, Buffer.from(m[2], 'base64'));
    return `assets/${file}`;
  });

  /** Delete images in assets/ that no page mentions. `keep` is the list of
   *  vault-relative paths still in use. */
  ipcMain.handle('assets:clean', async (_e, keep) => {
    const dir = path.join(VAULT, 'assets');
    const keepSet = new Set((keep || []).map(k => path.basename(String(k))));
    let removed = 0;
    for (const f of await fs.readdir(dir).catch(() => [])) {
      if (f.startsWith('.') || keepSet.has(f)) continue;
      await fs.unlink(path.join(dir, f)).catch(() => {});
      removed++;
    }
    return removed;
  });

  /* Vector PDF. printToPDF renders the live DOM through Chromium's print
     pipeline: text stays text and SVG stays paths, at whatever size the reader
     zooms to. The page sizes come from @page rules the renderer builds. */
  ipcMain.handle('pdf:print', async (_e, { name, widthIn, heightIn }) => {
    if (!win) return false;
    const r = await dialog.showSaveDialog(win, {
      defaultPath: `${name || 'drawing'}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return false;
    const buf = await win.webContents.printToPDF({
      pageSize: { width: widthIn, height: heightIn },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      preferCSSPageSize: true,
    });
    await fs.writeFile(r.filePath, buf);
    return r.filePath;
  });

  ipcMain.handle('vault:reveal', () => { shell.openPath(ensureVault()); });

  ipcMain.handle('shell:open', (_e, url) => {
    if (/^https?:\/\//i.test(url || '')) shell.openExternal(url);
  });

  // Generic save/open used by the .canvas and .md exporters.
  ipcMain.handle('file:exportText', async (_e, { name, text, filters }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: filters || [] });
    if (r.canceled || !r.filePath) return false;
    await fs.writeFile(r.filePath, text, 'utf8');
    return true;
  });

  ipcMain.handle('file:importText', async (_e, { filters } = {}) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: filters || [] });
    if (r.canceled || !r.filePaths[0]) return null;
    const abs = r.filePaths[0];
    return { name: path.basename(abs), path: abs, text: await fs.readFile(abs, 'utf8') };
  });

  ipcMain.handle('vault:choose', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    VAULT = r.filePaths[0];
    vaultFellBack = false;
    ensureVault();
    saveSettings({ vault: VAULT });
    startWatcher();
    return VAULT;
  });

  ipcMain.handle('export:png', async (_e, { name, rect }) => {
    if (!win) return false;
    const img = await win.webContents.capturePage({
      x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)),
      width: Math.round(rect.width), height: Math.round(rect.height),
    });
    const r = await dialog.showSaveDialog(win, { defaultPath: `${name || 'canvas'}.png` });
    if (r.canceled || !r.filePath) return false;
    await fs.writeFile(r.filePath, img.toPNG());
    return true;
  });
}

// ---------------------------------------------------------------------------
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'CanvasLide',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 18 },
    backgroundColor: '#16161a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Links go to the default browser, never to a new app window — and nothing
  // may navigate the app itself away from its own page.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
    else if (path.basename(new URL(url).pathname) !== 'index.html') e.preventDefault();
  });

  // Surface renderer errors in the terminal — makes iterating far less blind.
  win.webContents.on('console-message', (ev) => {
    if (ev.level === 'error' || ev.level === 'warning') {
      console.error(`[renderer ${ev.level}] ${ev.message}  (${ev.sourceId}:${ev.lineNumber})`);
    }
  });
  win.webContents.on('render-process-gone', (_e, d) => console.error('[renderer gone]', d));
  win.on('closed', () => { win = null; });
}

const send = (ch) => () => win && win.webContents.send(ch);

function buildMenu() {
  const template = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Page', accelerator: 'CmdOrCtrl+N', click: send('menu:new-page') },
        { label: 'Quick Switcher…', accelerator: 'CmdOrCtrl+K', click: send('menu:switcher') },
        { type: 'separator' },
        { label: 'Export Page as PNG…', accelerator: 'CmdOrCtrl+Shift+E', click: send('menu:export-png') },
        { label: 'Export as .canvas (JSON Canvas)…', click: send('menu:export-canvas') },
        { label: 'Export as Markdown…', click: send('menu:export-md') },
        { label: 'Import .canvas…', accelerator: 'CmdOrCtrl+Shift+I', click: send('menu:import-canvas') },
        { type: 'separator' },
        { label: 'Export Selected Section as PDF…', accelerator: 'CmdOrCtrl+P', click: send('menu:pdf-section') },
        { label: 'Export All Sections as PDF…', click: send('menu:pdf-all') },
        { label: 'Export Whole Page as PDF…', accelerator: 'CmdOrCtrl+Alt+P', click: send('menu:pdf-page') },
        { type: 'separator' },
        { label: "Today's Daily Note", accelerator: 'CmdOrCtrl+Shift+D', click: send('menu:daily') },
        { type: 'separator' },
        { label: 'Open Vault Folder', click: () => shell.openPath(ensureVault()) },
        { label: 'Change Vault Folder…', click: send('menu:change-vault') },
        { label: 'Empty Trash…', click: send('menu:empty-trash') },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // Custom handlers: the renderer routes these to native text undo while
        // typing and to document undo otherwise.
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('menu:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: send('menu:redo') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'pasteAndMatchStyle' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette…', accelerator: 'CmdOrCtrl+Shift+P', click: send('menu:palette') },
        { label: 'Graph View', accelerator: 'CmdOrCtrl+G', click: send('menu:graph') },
        { label: 'Outline', accelerator: 'CmdOrCtrl+Shift+O', click: send('menu:outline') },
        { type: 'separator' },
        // ⇧1 / ⇧2 are handled in the renderer, where they can tell typing
        // from a shortcut. As menu accelerators they would fire on "!" and "@".
        { label: 'Zoom to Fit\t⇧1', click: send('menu:zoom-fit') },
        { label: 'Zoom to Selection\t⇧2', click: send('menu:zoom-sel') },
        { label: 'Zoom to 100%', accelerator: 'CmdOrCtrl+0', click: send('menu:zoom-100') },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: send('menu:toggle-sidebar') },
        { type: 'separator' },
        { role: 'toggleDevTools' }, { role: 'reload' }, { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  ensureVault();
  registerIpc();
  buildMenu();
  createWindow();
  startWatcher();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', stopWatcher);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
