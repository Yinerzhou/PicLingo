'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const mode = process.argv.find(arg => arg.startsWith('--piclingo-material='))?.split('=')[1] || 'fallback';
contextBridge.exposeInMainWorld('piclingo', {
  platform: process.platform,
  pathForFile: file => webUtils.getPathForFile(file),
  psdChooseFiles: () => ipcRenderer.invoke('psd:choose-files'),
  psdChooseExcel: () => ipcRenderer.invoke('psd:choose-excel'),
  psdChooseOutput: () => ipcRenderer.invoke('psd:choose-output'),
  psdRun: request => ipcRenderer.invoke('psd:run', request),
  psdStop: () => ipcRenderer.invoke('psd:stop'),
  psdOpenOutput: () => ipcRenderer.invoke('psd:open-output'),
  psdOpenLogs: () => ipcRenderer.invoke('psd:open-logs'),
  exportLogs: () => ipcRenderer.invoke('psd:export-logs'),
  getUpdateSettings: () => ipcRenderer.invoke('release:settings'),
  configureUpdates: (repository, automatic) => ipcRenderer.invoke('release:configure', repository, automatic),
  checkUpdates: () => ipcRenderer.invoke('release:check'),
  installUpdate: () => ipcRenderer.invoke('release:install'),
  onPsdProgress: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('psd:progress', listener);
    return () => ipcRenderer.removeListener('psd:progress', listener);
  },
  appearance: { mode },
  minimize: () => ipcRenderer.invoke('piclingo:window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('piclingo:window-maximize'),
  close: () => ipcRenderer.invoke('piclingo:window-close'),
  isMaximized: () => ipcRenderer.invoke('piclingo:window-is-maximized'),
  getAppearance: () => ipcRenderer.invoke('piclingo:appearance-get'),
  setBackgroundMode: mode => ipcRenderer.invoke('piclingo:appearance-set', mode),
  translateImage: request => ipcRenderer.invoke('piclingo:translate', request),
  renderImage: request => ipcRenderer.invoke('piclingo:render', request),
  getModels: () => ipcRenderer.invoke('piclingo:models'),
  installModel: target => ipcRenderer.invoke('piclingo:install-model', target),
  releaseDocuments: ids => ipcRenderer.invoke('piclingo:release', ids),
  saveImage: id => ipcRenderer.invoke('piclingo:save-image', id),
  exportImages: ids => ipcRenderer.invoke('piclingo:export-images', ids),
  onProgress: callback => {
    const listener = (_event, text) => callback(String(text));
    ipcRenderer.on('piclingo:progress', listener);
    return () => ipcRenderer.removeListener('piclingo:progress', listener);
  },
  onMaximizedChanged: callback => {
    const listener = (_event, value) => callback(Boolean(value));
    ipcRenderer.on('piclingo:window-maximized', listener);
    return () => ipcRenderer.removeListener('piclingo:window-maximized', listener);
  },
  onAppearanceChanged: callback => {
    const listener = (_event, appearance) => callback(appearance);
    ipcRenderer.on('piclingo:appearance-changed', listener);
    return () => ipcRenderer.removeListener('piclingo:appearance-changed', listener);
  }
});
