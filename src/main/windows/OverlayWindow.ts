import { BrowserWindow } from 'electron'
import { join } from 'path'

export class OverlayWindow {
  private window: BrowserWindow | null = null

  constructor() {
    this.createWindow()
  }

  private createWindow(): void {
    this.window = new BrowserWindow({
      width: 400,
      height: 200,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: join(__dirname, '../preload/overlay-preload.cjs'),
      },
    })

    if (process.env.NODE_ENV === 'development') {
      this.window.loadURL('http://localhost:5173/src/renderer/overlay/index.html')
    } else {
      this.window.loadFile(join(__dirname, '../renderer/overlay/index.html'))
    }
  }

  public getWindow(): BrowserWindow | null {
    return this.window
  }
}
