import { contextBridge, ipcRenderer } from 'electron'
import type { OverlayDisplayRequestV1, OverlayPreferenceV1 } from '@echocue/contracts'
import { IpcChannel } from '../shared/ipc-channels.js'

// CONTRACT §7: minimal overlay preload — display/hide + read-only preference
// events and the first-frame ack. No config, persona, audit or service control.
const overlayApi = {
  overlay: {
    onDisplay: (cb: (req: OverlayDisplayRequestV1) => void): (() => void) => {
      const listener = (_e: unknown, req: OverlayDisplayRequestV1) => cb(req)
      ipcRenderer.on(IpcChannel.OverlayDisplay, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannel.OverlayDisplay, listener)
      }
    },
    onHide: (cb: () => void): (() => void) => {
      const listener = () => cb()
      ipcRenderer.on(IpcChannel.OverlayHide, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannel.OverlayHide, listener)
      }
    },
    onPreference: (cb: (prefs: OverlayPreferenceV1) => void): (() => void) => {
      const listener = (_e: unknown, prefs: OverlayPreferenceV1) => cb(prefs)
      ipcRenderer.on(IpcChannel.OverlayPreferenceChanged, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannel.OverlayPreferenceChanged, listener)
      }
    },
    ack: (requestId: string) =>
      ipcRenderer.invoke(IpcChannel.OverlayAck, { requestId }) as Promise<void>,
  },
}

contextBridge.exposeInMainWorld('echocue', overlayApi)
