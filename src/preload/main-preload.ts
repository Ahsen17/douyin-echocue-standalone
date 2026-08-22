import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectionTestResultV1, ServiceViewState } from '@echocue/contracts'
import { IpcChannel } from '../shared/ipc-channels.js'

const echocueApi = {
  window: {
    close: () => ipcRenderer.send(IpcChannel.WindowClose),
    minimize: () => ipcRenderer.send(IpcChannel.WindowMinimize),
    maximize: () => ipcRenderer.send(IpcChannel.WindowMaximize),
    onMaximizeChange: (cb: (isMax: boolean) => void) => {
      ipcRenderer.on(IpcChannel.WindowMaximizeChanged, (_e, v) => cb(v as boolean))
    },
  },
  service: {
    subscribe: (cb: (state: ServiceViewState) => void): (() => void) => {
      const listener = (_e: unknown, state: ServiceViewState) => cb(state)
      ipcRenderer.on(IpcChannel.ServiceStateChanged, listener)
      ipcRenderer.invoke(IpcChannel.ServiceStateSubscribe).catch(() => undefined)
      return () => {
        ipcRenderer.removeListener(IpcChannel.ServiceStateChanged, listener)
      }
    },
    start: () => ipcRenderer.invoke(IpcChannel.ServiceStart) as Promise<ServiceViewState>,
    stop: () => ipcRenderer.invoke(IpcChannel.ServiceStop) as Promise<ServiceViewState>,
  },
  provider: {
    setApiKey: (providerId: string, apiKey: string) =>
      ipcRenderer.invoke(IpcChannel.ProviderCredentialSet, {
        providerId,
        apiKey,
      }) as Promise<{ apiKeyConfigured: boolean }>,
    clearApiKey: (providerId: string) =>
      ipcRenderer.invoke(IpcChannel.ProviderCredentialClear, {
        providerId,
      }) as Promise<{ apiKeyConfigured: boolean }>,
    testConnection: () =>
      ipcRenderer.invoke(IpcChannel.ProviderCredentialTest) as Promise<ConnectionTestResultV1>,
  },
}

export type EchocueApi = typeof echocueApi

contextBridge.exposeInMainWorld('echocue', echocueApi)
