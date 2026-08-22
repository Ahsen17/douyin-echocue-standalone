import { app, safeStorage, type WebContents } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { MainWindow } from './windows/MainWindow.js'
import { TrayManager } from './windows/TrayManager.js'
import {
  createServiceController,
  wireServiceControl,
  wireStateBroadcast,
  type CreatedServiceController,
} from './service/index.js'
import { wireDiagnosticsControl } from './telemetry/index.js'
import { wireProviderControl } from './provider/index.js'
import { wireConfigControl } from './config/index.js'
import { wirePersonaControl } from './persona/index.js'
import { wireSafetyControl } from './safety/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindowInstance: MainWindow | null = null
let trayManager: TrayManager | null = null
let services: CreatedServiceController | null = null
let isExplicitQuit = false

function getIsExplicitQuit(): boolean {
  return isExplicitQuit
}

function showMainWindow(): void {
  mainWindowInstance?.show()
}

async function doQuit(): Promise<void> {
  isExplicitQuit = true
  trayManager?.dispose()
  try {
    await services?.controller.stop()
  } catch {
    /* best-effort stop before exit */
  }
  services?.shutdown()
  const win = mainWindowInstance?.getWindow()
  if (win && !win.isDestroyed()) {
    win.destroy()
  }
  app.quit()
}

function resolveAssetBinary(kind: 'qdrant' | 'douyinLive'): string {
  const name = process.platform === 'win32' ? `${kind}_windows.exe` : `${kind}_linux`
  return join(process.cwd(), 'assets', name)
}

app.whenReady().then(async () => {
  mainWindowInstance = new MainWindow(getIsExplicitQuit)

  const isTrustedSender = (contents: WebContents) =>
    contents === mainWindowInstance?.getWindow()?.webContents

  try {
    services = await createServiceController({
      dataDir: app.getPath('userData'),
      safeStorage,
      douyinLiveBinaryPath: resolveAssetBinary('douyinLive'),
      qdrantBinaryPath: resolveAssetBinary('qdrant'),
      migrationPath: join(process.cwd(), 'docs/06-data-interface/migrations/001_initial_schema.sql'),
      keyVersion: '1',
      cleanupOnStop: () => {
        /* overlay/candidates/in-flight are wired by M5/M6 */
      },
    })
    services.stateMachine.onChanged((state) => {
      services?.diagnostics.updateLifecycle(state.lifecycle, state.activity)
    })
    wireStateBroadcast({ stateMachine: services.stateMachine, isTrustedSender })
    wireServiceControl({ controller: services.controller, isTrustedSender })
    wireProviderControl({ configService: services.providerConfig, isTrustedSender })
    wireConfigControl({
      settings: services.settings,
      providerConfig: services.providerConfig,
      isTrustedSender,
    })
    wirePersonaControl({ persona: services.persona, isTrustedSender })
    wireSafetyControl({ safety: services.safety, isTrustedSender })
    wireDiagnosticsControl({ diagnostics: services.diagnostics, isTrustedSender })
  } catch (err) {
    // bootstrap failure keeps the app usable; the gate fails closed until stores assemble
    console.error('service bootstrap failed', err)
  }

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
