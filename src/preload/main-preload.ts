import { contextBridge, ipcRenderer } from 'electron'
import type { ServiceViewState } from '@echocue/contracts'

contextBridge.exposeInMainWorld('echocue', {
  window: {
    close: () => ipcRenderer.send('window:close'),
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    onMaximizeChange: (cb: (isMax: boolean) => void) => {
      ipcRenderer.on('window:maximize-changed', (_e, v) => cb(v as boolean))
    },
  },
  service: {
    subscribe: (cb: (state: ServiceViewState) => void): (() => void) => {
      const listener = (_e: unknown, state: ServiceViewState) => cb(state)
      ipcRenderer.on('service.state.changed', listener)
      ipcRenderer.invoke('service.state.subscribe').catch(() => undefined)
      return () => {
        ipcRenderer.removeListener('service.state.changed', listener)
      }
    },
    start: () => ipcRenderer.invoke('service.start') as Promise<ServiceViewState>,
    stop: () => ipcRenderer.invoke('service.stop') as Promise<ServiceViewState>,
  },
})
