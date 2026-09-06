'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  vaultPath:   ()      => ipcRenderer.invoke('vault:path'),
  vaultInfo:   ()      => ipcRenderer.invoke('vault:info'),
  listPages:   ()      => ipcRenderer.invoke('vault:list'),
  readIndex:   ()      => ipcRenderer.invoke('vault:index'),
  readAll:     ()      => ipcRenderer.invoke('vault:readAll'),
  readPage:    (id)    => ipcRenderer.invoke('page:read', id),
  writePage:   (doc)   => ipcRenderer.invoke('page:write', doc),
  deletePage:  (id)    => ipcRenderer.invoke('page:delete', id),
  listFolders: ()      => ipcRenderer.invoke('folder:list'),
  createFolder:(n)     => ipcRenderer.invoke('folder:create', n),
  renameFolder:(p)     => ipcRenderer.invoke('folder:rename', p),
  deleteFolder:(n)     => ipcRenderer.invoke('folder:delete', n),
  saveAsset:   (p)     => ipcRenderer.invoke('asset:save', p),
  revealVault: ()      => ipcRenderer.invoke('vault:reveal'),
  chooseVault: ()      => ipcRenderer.invoke('vault:choose'),
  exportPng:   (p)     => ipcRenderer.invoke('export:png', p),
  exportText:  (p)     => ipcRenderer.invoke('file:exportText', p),
  importText:  (p)     => ipcRenderer.invoke('file:importText', p || {}),
  openExternal:(u)     => ipcRenderer.invoke('shell:open', u),
  captureRegion:(r)    => ipcRenderer.invoke('capture:region', r),
  savePdf:     (p)     => ipcRenderer.invoke('pdf:save', p),
  printPdf:    (p)     => ipcRenderer.invoke('pdf:print', p),
  onMenu: (channel, fn) => ipcRenderer.on(channel, () => fn()),
});
