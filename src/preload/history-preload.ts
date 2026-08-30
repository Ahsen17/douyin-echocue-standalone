import { contextBridge, ipcRenderer } from 'electron'
import type { HistorySnapshotV1, OverlayPreferenceV1 } from '@echocue/contracts'
import { IpcChannel } from '../shared/ipc-channels.js'

// CONTRACT §7: minimal history preload — mount-time snapshot request plus the
// read-only snapshot/preference events pushed by main. No config, persona, audit
// or service control; the trusted-sender guard lives in the main handler.
const historyApi = {
  history: {
    getSnapshot: () =>
      ipcRenderer.invoke(IpcChannel.HistoryGetSnapshot) as Promise<HistorySnapshotV1>,
    onSnapshot: (cb: (snap: HistorySnapshotV1) => void): (() => void) => {
      const listener = (_e: unknown, snap: HistorySnapshotV1) => cb(snap)
      ipcRenderer.on(IpcChannel.HistorySnapshotChanged, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannel.HistorySnapshotChanged, listener)
      }
    },
    onPreference: (cb: (prefs: OverlayPreferenceV1) => void): (() => void) => {
      const listener = (_e: unknown, prefs: OverlayPreferenceV1) => cb(prefs)
      ipcRenderer.on(IpcChannel.HistoryPreferenceChanged, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannel.HistoryPreferenceChanged, listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('echocue', historyApi)
