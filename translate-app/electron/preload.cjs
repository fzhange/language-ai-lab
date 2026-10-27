const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  translate: (request, requestId) => ipcRenderer.invoke('translation:run', request, requestId),
  onMentorText: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('mentor:text', listener)
    return () => ipcRenderer.removeListener('mentor:text', listener)
  },
  cancel: () => ipcRenderer.invoke('translation:cancel'),
  readAloud: (text, requestId) => ipcRenderer.invoke('speech:read', text, requestId),
  stopReading: () => ipcRenderer.invoke('speech:stop'),
  onSpeechState: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('speech:state', listener)
    return () => ipcRenderer.removeListener('speech:state', listener)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  checkConnection: () => ipcRenderer.invoke('service:check'),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  hide: () => ipcRenderer.invoke('window:hide'),
  getAccessibilityPermission: () => ipcRenderer.invoke('selection:permission'),
  requestAccessibilityPermission: () => ipcRenderer.invoke('selection:request-permission'),
  onWake: (callback) => {
    const listener = (_event, payload) => callback(payload ?? {})
    ipcRenderer.on('window:wake', listener)
    ipcRenderer.invoke('window:ready').catch(() => {})
    return () => ipcRenderer.removeListener('window:wake', listener)
  },
})
