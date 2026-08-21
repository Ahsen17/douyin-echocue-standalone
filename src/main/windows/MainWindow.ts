import { BrowserWindow } from 'electron'
import { join } from 'path'

export class MainWindow {
  private window: BrowserWindow | null = null

  constructor() {
    this.createWindow()
  }

  private createWindow(): void {
    this.window = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: join(__dirname, '../preload/main-preload.js'),
      },
    })

    if (process.env.NODE_ENV === 'development') {
      this.window.loadURL('http://localhost:5173/src/renderer/main/index.html')
      this.window.webContents.openDevTools()
    } else {
      this.window.loadFile(join(__dirname, '../renderer/main/index.html'))
    }
  }

  public getWindow(): BrowserWindow | null {
    return this.window
  }
}
