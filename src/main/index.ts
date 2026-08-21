import { app, BrowserWindow } from 'electron'
import { MainWindow } from './windows/MainWindow'
import { OverlayWindow } from './windows/OverlayWindow'

let _mainWindow: MainWindow | null = null
let _overlayWindow: OverlayWindow | null = null

function createWindows() {
  _mainWindow = new MainWindow()
  _overlayWindow = new OverlayWindow()
}

app.whenReady().then(() => {
  createWindows()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindows()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
