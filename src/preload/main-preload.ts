import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('echocue', {
  // Empty API placeholder for M0-01
  // Real IPC methods will be added in later tasks
})
