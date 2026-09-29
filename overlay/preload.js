'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jadeBridge', {
  copy: (text) => ipcRenderer.send('jade:copy', String(text)),
  setInteractive: (on) => ipcRenderer.send('jade:interactive', !!on),
  onToggleShop: (cb) => ipcRenderer.on('jade:toggle-shop', () => cb()),
  onCalibrate: (cb) => ipcRenderer.on('jade:calibrate', (_e, on) => cb(on)),
});
