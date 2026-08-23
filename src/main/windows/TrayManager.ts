import { Tray, Menu, nativeImage, dialog } from 'electron'
import { join } from 'path'
import { resolveResourcePath } from '../util/index.js'

interface TrayManagerOptions {
  onShow: () => void
  onQuit: () => void
}

// Minimal 16x16 transparent PNG as fallback when build icon is unavailable
const FALLBACK_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAC0lEQVQ42mNk' +
  'YAAAAAoAAkjBplyAAAAASUVORK5CYII='

export class TrayManager {
  private tray: Tray | null = null
  private readonly onShow: () => void
  private readonly onQuit: () => void

  constructor(options: TrayManagerOptions) {
    this.onShow = options.onShow
    this.onQuit = options.onQuit
    this.createTray()
  }

  private createTray(): void {
    const trayImage = nativeImage.createFromPath(resolveResourcePath(join('build', 'tray.png')))
    const icon = trayImage.isEmpty()
      ? nativeImage.createFromDataURL(`data:image/png;base64,${FALLBACK_ICON_BASE64}`)
      : trayImage
    this.tray = new Tray(icon)
    this.tray.setToolTip('Echocue：未启动')
    this.tray.setContextMenu(this.buildMenu())

    this.tray.on('click', () => this.onShow())
    this.tray.on('double-click', () => this.onShow())
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => this.onShow() },
      { type: 'separator' },
      {
        label: '退出 Echocue',
        click: () => {
          const confirmed = dialog.showMessageBoxSync({
            type: 'question',
            buttons: ['取消', '退出'],
            defaultId: 1,
            cancelId: 0,
            title: '退出 Echocue',
            message: '退出会停止监听并关闭浮窗，确定退出？',
          })
          if (confirmed === 1) {
            this.onQuit()
          }
        },
      },
    ])
  }

  public setTooltip(status: string): void {
    this.tray?.setToolTip(`Echocue：${status}`)
  }

  public dispose(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
