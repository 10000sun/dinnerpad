const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dp', {
  state: () => ipcRenderer.invoke('state'),
  save: (config) => ipcRenderer.invoke('save', config),
  hotkeys: (on) => ipcRenderer.invoke('hotkeys', on),
  pick: () => ipcRenderer.invoke('pick'),
  onPlay: (cb) => ipcRenderer.on('play', (_, i) => cb(i)),
});
