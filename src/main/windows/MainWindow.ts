import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { IpcChannel } from '../../shared/ipc-channels.js'
import { resolveResourcePath } from '../util/index.js'

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
      icon: resolveResourcePath(join('build', 'icon.png')),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: join(__dirname, '../preload/main-preload.cjs'),
      },
    })

    if (process.env.NODE_ENV === 'development') {
      this.window.loadURL('http://localhost:5173/main/index.html')
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
      this.window?.webContents.send(IpcChannel.WindowMaximizeChanged, true)
    })

    this.window.on('unmaximize', () => {
      this._isMaximized = false
      this.window?.webContents.send(IpcChannel.WindowMaximizeChanged, false)
    })
  }

  private registerIpcHandlers(): void {
    // CONTRACT §7: window chrome must only respond to this window's own sender.
    // Fire-and-forget channel: ignore untrusted senders (fail closed) rather
    // than throw — a throw in an ipcMain.on listener is an uncaught main error.
    const fromThisWindow = (event: { sender: WebContents }): boolean =>
      event.sender === this.window?.webContents
    ipcMain.on(IpcChannel.WindowClose, (e) => {
      if (!fromThisWindow(e)) return
      this.hide()
    })
    ipcMain.on(IpcChannel.WindowMinimize, (e) => {
      if (!fromThisWindow(e)) return
      this.minimize()
    })
    ipcMain.on(IpcChannel.WindowMaximize, (e) => {
      if (!fromThisWindow(e)) return
      this.toggleMaximize()
    })
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
    ipcMain.removeAllListeners(IpcChannel.WindowClose)
    ipcMain.removeAllListeners(IpcChannel.WindowMinimize)
    ipcMain.removeAllListeners(IpcChannel.WindowMaximize)
    this.window?.destroy()
    this.window = null
  }
}
