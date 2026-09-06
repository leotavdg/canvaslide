'use strict';
const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fssync = require('fs');
const pdf = require('./pdf');

/** Read width/height out of a JPEG's SOF marker — the only reliable way to
 *  know the real pixel size of what capturePage handed back. */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { w: 0, h: 0 };
}

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

async function listPages() {
  ensureVault();
  pathById.clear();
  const out = [];
  for (const { abs, folder, file } of walk(VAULT)) {
    try {
      const doc = JSON.parse(await fs.readFile(abs, 'utf8'));
      const id = doc.id || file.replace('.canvaslide.json', '');
      pathById.set(id, abs);
      out.push({
        id,
        name: doc.name || 'Untitled',
        folder,
        updated: doc.updated || 0,
        nodeCount: (doc.nodes || []).length,
      });
    } catch (e) {
      console.warn('skip unreadable page', file, e.message);
    }
  }
  out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return out;
}

/** Full text of every page — powers search and backlink resolution. */
async function readAll() {
  ensureVault();
  const docs = [];
  for (const { abs, folder } of walk(VAULT)) {
    try {
      const d = JSON.parse(await fs.readFile(abs, 'utf8'));
      d.folder = folder;
      docs.push(d);
    } catch (_) {}
  }
  return docs;
}

/** One pass over the vault serving the page list, the full-text index and the
 *  folder tree. Previously these were three separate walks and two full reads
 *  of every file, repeated on every save. */
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
      pages.push({
        id, name: doc.name || 'Untitled', folder,
        updated: doc.updated || 0,
        nodeCount: (doc.nodes || []).length,
      });
    } catch (e) {
      console.warn('skip unreadable page', file, e.message);
    }
  }
  pages.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return { pages, docs, folders: allFolders() };
}

function registerIpc() {
  ipcMain.handle('vault:index', () => readIndex());
  ipcMain.handle('vault:path', () => ensureVault());
  ipcMain.handle('vault:info', () => ({ path: ensureVault(), fellBack: vaultFellBack }));
  ipcMain.handle('vault:list', () => listPages());
  ipcMain.handle('vault:readAll', () => readAll());

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
    ensureVault();
    try {
      const target = pageFile(doc.id, doc.folder != null ? doc.folder : undefined);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const prev = pathById.get(doc.id);
      await fs.writeFile(target, JSON.stringify(doc, null, 2), 'utf8');
      if (prev && prev !== target) await fs.unlink(prev).catch(() => {});
      pathById.set(doc.id, target);
      return true;
    } catch (e) {
      console.error('page:write failed:', e.message);
      return false;
    }
  });

  ipcMain.handle('page:delete', async (_e, id) => {
    try { await fs.unlink(pageFile(id)); return true; } catch (e) { return false; }
  });

  // Images are copied into the vault so pages stay portable.
  ipcMain.handle('asset:save', async (_e, { name, dataUrl }) => {
    ensureVault();
    const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl || '');
    if (!m) return null;
    const ext = (m[1].split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
    const file = `${Date.now().toString(36)}-${(name || 'img').replace(/[^\w.-]/g, '_')}.${ext}`;
    const abs = path.join(VAULT, 'assets', file);
    await fs.writeFile(abs, Buffer.from(m[2], 'base64'));
    return `assets/${file}`;
  });

  // Grab a rectangle of the live window as JPEG — the source frames for PDF export.
  ipcMain.handle('capture:region', async (_e, rect) => {
    if (!win) return null;
    const img = await win.webContents.capturePage({
      x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)),
    });
    const jpeg = img.toJPEG(94);
    const size = jpegSize(jpeg);
    return { b64: jpeg.toString('base64'), pxW: size.w, pxH: size.h };
  });

  /* Vector PDF. The old path screenshotted the window and wrapped the JPEG,
     which is why exports were soft and didn't scale. printToPDF renders the
     live DOM through Chromium's print pipeline instead: text stays text and
     SVG stays paths, at whatever size the reader zooms to. */
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

  ipcMain.handle('pdf:save', async (_e, { name, pages }) => {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: `${name || 'drawing'}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return false;
    const buf = pdf.build(pages.map(p => ({
      jpeg: Buffer.from(p.b64, 'base64'),
      pxW: p.pxW, pxH: p.pxH, ptW: p.ptW, ptH: p.ptH,
    })));
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
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    VAULT = r.filePaths[0];
    ensureVault();
    saveSettings({ vault: VAULT });
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

  // Surface renderer errors in the terminal — makes iterating far less blind.
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message}  (${sourceId}:${line})`);
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
      ],
    },
    {
      label: 'Edit',
      submenu: [
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
        { label: 'Zoom to Fit', accelerator: 'Shift+1', click: send('menu:zoom-fit') },
        { label: 'Zoom to Selection', accelerator: 'Shift+2', click: send('menu:zoom-sel') },
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
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
