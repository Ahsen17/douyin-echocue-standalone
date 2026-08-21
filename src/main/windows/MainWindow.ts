import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export class MainWindow {
  private window: BrowserWindow | null = null
  private _isMaximized = false

  constructor(private readonly getIsExplicitQuit: () => boolean) {
    this.createWindow()
    this.registerIpcHandlers()
  }

  private createWindow(): void {
    this.window = new BrowserWindow({
      width: 1200,
      height: 800,
      frame: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: join(__dirname, '../preload/main-preload.js'),
      },
    })

    if (process.env.NODE_ENV === 'development') {
      this.window.loadURL('http://localhost:5173/src/renderer/main/index.html')
    } else {
      this.window.loadFile(join(__dirname, '../renderer/main/index.html'))
    }

    this.window.on('close', (e) => {
      if (!this.getIsExplicitQuit()) {
        e.preventDefault()
        this.window?.hide()
      }
    })

    this.window.on('maximize', () => {
      this._isMaximized = true
      this.window?.webContents.send('window:maximize-changed', true)
    })

    this.window.on('unmaximize', () => {
      this._isMaximized = false
      this.window?.webContents.send('window:maximize-changed', false)
    })
  }

  private registerIpcHandlers(): void {
    ipcMain.on('window:close', () => this.hide())
    ipcMain.on('window:minimize', () => this.minimize())
    ipcMain.on('window:maximize', () => this.toggleMaximize())
  }

  public getWindow(): BrowserWindow | null {
    return this.window
  }

  public show(): void {
    if (this.window) {
      this.window.show()
      this.window.focus()
    }
  }

  public hide(): void {
    this.window?.hide()
  }

  public minimize(): void {
    this.window?.minimize()
  }

  public toggleMaximize(): void {
    if (!this.window) return
    if (this._isMaximized) {
      this.window.unmaximize()
    } else {
      this.window.maximize()
    }
  }

  public destroy(): void {
    ipcMain.removeAllListeners('window:close')
    ipcMain.removeAllListeners('window:minimize')
    ipcMain.removeAllListeners('window:maximize')
    this.window?.destroy()
    this.window = null
  }
}
