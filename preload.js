// 只開放少數安全的安全的通道給畫面使用，畫面無法直接碰檔案系統
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('leiyiNative', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  dataPath: () => ipcRenderer.invoke('data:path'),
  exportFile: (name, text) => ipcRenderer.invoke('data:export', name, text),
  version: () => ipcRenderer.invoke('app:version'),
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (fn) => ipcRenderer.on('update:status', (_e, s) => fn(s))
  },
  autoBackup: (data) => ipcRenderer.invoke('data:autoBackup', data),
  notion: {
    setToken: (t) => ipcRenderer.invoke('notion:setToken', t),
    hasToken: () => ipcRenderer.invoke('notion:hasToken'),
    clearToken: () => ipcRenderer.invoke('notion:clearToken'),
    request: (method, path, body) => ipcRenderer.invoke('notion:request', method, path, body)
  }
});
