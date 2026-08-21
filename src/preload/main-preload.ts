import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('echocue', {
  window: {
    close: () => ipcRenderer.send('window:close'),
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    onMaximizeChange: (cb: (isMax: boolean) => void) => {
      ipcRenderer.on('window:maximize-changed', (_e, v) => cb(v as boolean))
    },
  },
})
