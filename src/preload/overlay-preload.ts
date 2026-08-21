import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('echocue', {
  // Minimal overlay API placeholder for M0-01
  // Real overlay IPC methods will be added in later tasks
})
