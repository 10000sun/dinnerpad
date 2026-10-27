const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dp', {
  state: () => ipcRenderer.invoke('state'),
  save: (config) => ipcRenderer.invoke('save', config),
  hotkeys: (on) => ipcRenderer.invoke('hotkeys', on),
  pick: () => ipcRenderer.invoke('pick'),
  autostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (on) => ipcRenderer.invoke('autostart:set', on),
  openRepo: () => ipcRenderer.invoke('repo:open'),
  onPlay: (cb) => ipcRenderer.on('play', (_, i) => cb(i)),
  onPatch: (cb) => ipcRenderer.on('config-patch', (_, p) => cb(p)),
});
