'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script - exposes a typed, secure API surface to the renderer
 * via contextBridge. No raw Node/Electron APIs are exposed.
 */
contextBridge.exposeInMainWorld('api', {
  // Camera management
  camera: {
    getAll: () => ipcRenderer.invoke('camera:getAll'),
    add: (data) => ipcRenderer.invoke('camera:add', data),
    update: (id, data) => ipcRenderer.invoke('camera:update', id, data),
    delete: (id) => ipcRenderer.invoke('camera:delete', id),
  },

  // Stream control
  stream: {
    start: (id) => ipcRenderer.invoke('stream:start', id),
    stop: (id) => ipcRenderer.invoke('stream:stop', id),
    stopAll: () => ipcRenderer.invoke('stream:stopAll'),
    status: (id) => ipcRenderer.invoke('stream:status', id),
    snapshot: (id) => ipcRenderer.invoke('stream:snapshot', id),
    startAudio: (id) => ipcRenderer.invoke('stream:startAudio', id),
    stopAudio: (id) => ipcRenderer.invoke('stream:stopAudio', id),
  },

  // Storage / settings
  storage: {
    getSettings: () => ipcRenderer.invoke('storage:getSettings'),
    saveSettings: (settings) => ipcRenderer.invoke('storage:saveSettings', settings),
  },

  // App utilities
  app: {
    selectDirectory: () => ipcRenderer.invoke('app:selectDirectory'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    exportSettings: () => ipcRenderer.invoke('app:exportSettings'),
    importSettings: () => ipcRenderer.invoke('app:importSettings'),
    resetSettings: () => ipcRenderer.invoke('app:resetSettings'),
  },

  // Network probe
  probe: {
    getSubnet: () => ipcRenderer.invoke('probe:getSubnet'),
    start: (subnet) => ipcRenderer.invoke('probe:start', subnet),
    cancel: () => ipcRenderer.invoke('probe:cancel'),
  },

  // Web Server
  webserver: {
    getStatus: () => ipcRenderer.invoke('webserver:status'),
    start: (port) => ipcRenderer.invoke('webserver:start', port),
    stop: () => ipcRenderer.invoke('webserver:stop'),
  },

  // Event listeners from main process
  on: (channel, callback) => {
    const allowedChannels = [
      'stream:frame', 'stream:error', 'stream:status', 'stream:stats', 'stream:audio',
      'probe:progress', 'probe:found', 'probe:done', 'probe:cancelled',
    ];
    if (allowedChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },

  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
});
