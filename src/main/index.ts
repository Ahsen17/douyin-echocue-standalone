import { app, dialog } from 'electron'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { MainWindow } from './windows/MainWindow.js'
import { TrayManager } from './windows/TrayManager.js'
import { ServiceStateMachine, wireStateBroadcast } from './service/index.js'
import { DiagnosticsSource } from './telemetry/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindowInstance: MainWindow | null = null
let trayManager: TrayManager | null = null
let isExplicitQuit = false

function getIsExplicitQuit(): boolean {
  return isExplicitQuit
}

function showMainWindow(): void {
  mainWindowInstance?.show()
}

function doQuit(): void {
  isExplicitQuit = true
  trayManager?.dispose()
  const win = mainWindowInstance?.getWindow()
  if (win && !win.isDestroyed()) {
    win.destroy()
  }
  app.quit()
}

app.whenReady().then(() => {
  mainWindowInstance = new MainWindow(getIsExplicitQuit)

  const diagnostics = new DiagnosticsSource()
  const stateMachine = new ServiceStateMachine()
  stateMachine.onChanged((state) => {
    diagnostics.updateLifecycle(state.lifecycle, state.activity)
  })
  wireStateBroadcast({
    stateMachine,
    isTrustedSender: (contents) => contents === mainWindowInstance?.getWindow()?.webContents,
  })

  trayManager = new TrayManager({
    onShow: showMainWindow,
    onQuit: doQuit,
  })
})

// Tray controls quit; do not exit on all-windows-closed
app.on('window-all-closed', () => {
  // intentionally empty — tray exit is the only exit path
})

app.on('activate', () => {
  showMainWindow()
})

app.on('before-quit', () => {
  isExplicitQuit = true
})
