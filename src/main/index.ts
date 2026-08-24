import { app, safeStorage, type WebContents } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { MainWindow } from './windows/MainWindow.js'
import { OverlayWindow } from './windows/OverlayWindow.js'
import { TrayManager } from './windows/TrayManager.js'
import {
  createServiceController,
  wireServiceControl,
  wireStateBroadcast,
  type CreatedServiceController,
} from './service/index.js'
import { Logger, wireDiagnosticsControl, wireMonitoringControl } from './telemetry/index.js'
import { RetentionScheduler } from './storage/index.js'
import { wireAuditControl } from './audit/index.js'
import { wireProviderControl } from './provider/index.js'
import { wireConfigControl } from './config/index.js'
import { wirePersonaControl } from './persona/index.js'
import { wireSafetyControl } from './safety/index.js'
import { wireRetrievalControl } from './retrieval/index.js'
import { compileRiskFilter } from './safety/risk-filter-config.js'
import { DataLocationStore } from './config/index.js'
import { createOverlayDisplaySink, wireOverlayControl } from './overlay/index.js'
import { resolveResourcePath } from './util/index.js'
import { SIDECAR_PINS, sidecarSha256 } from './sidecar-pins.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindowInstance: MainWindow | null = null
let overlayWindowInstance: OverlayWindow | null = null
let trayManager: TrayManager | null = null
let services: CreatedServiceController | null = null
let isExplicitQuit = false

// Grace period for windows/services to initialize before the --smoke-quit hook
// (T-PKG-001) walks the real graceful-exit path and quits.
const SMOKE_QUIT_DELAY_MS = 4000

if (app.isPackaged) {
  // RUNBOOK §2.3 / WP-5: data root defaults to %LOCALAPPDATA%\Echocue (Local),
  // so the (potentially large) audit/Qdrant data does not roam and never touches
  // the install directory. An assisted-install pointer may redirect it; the
  // pointer file sits at a fixed path so it is readable before userData is set.
  const localAppData = join(dirname(app.getPath('appData')), 'Local', 'Echocue')
  const dataRoot = new DataLocationStore(join(localAppData, 'data-location.json')).readSync()
  app.setPath('userData', dataRoot ?? localAppData)
}

// Daily main-process log under the data dir: <userData>/logs/main-YYYY-MM-DD.log.
// Created at module scope so early boot failures are captured too.
const logger = new Logger({ logDir: join(app.getPath('userData'), 'logs') })

function getIsExplicitQuit(): boolean {
  return isExplicitQuit
}

function showMainWindow(): void {
  mainWindowInstance?.show()
}

async function doQuit(): Promise<void> {
  isExplicitQuit = true
  logger.info('lifecycle', 'app quit')
  trayManager?.dispose()
  try {
    await services?.controller.stop()
  } catch {
    /* best-effort stop before exit */
  }
  // controller.stop() only owns the douyin sidecar; the Qdrant sidecar is owned
  // by the app boot and must be torn down here so no child survives exit.
  try {
    await services?.qdrant?.stop()
  } catch {
    /* best-effort sidecar stop before exit */
  }
  // WP-1: close the loopback /metrics endpoint on exit.
  await services?.metricsHub?.stopServer()
  services?.shutdown()
  overlayWindowInstance?.destroy()
  const win = mainWindowInstance?.getWindow()
  if (win && !win.isDestroyed()) {
    win.destroy()
  }
  app.quit()
}

function resolveAssetBinary(kind: 'qdrant' | 'douyinLive'): string {
  const name = process.platform === 'win32' ? `${kind}_windows.exe` : `${kind}_linux`
  return resolveResourcePath(join('assets', name))
}

app.whenReady().then(async () => {
  logger.info('lifecycle', 'app ready')
  mainWindowInstance = new MainWindow(getIsExplicitQuit)

  const isTrustedSender = (contents: WebContents) =>
    contents === mainWindowInstance?.getWindow()?.webContents

  // M6-07: eager overlay window; settings are read lazily once services exist.
  overlayWindowInstance = new OverlayWindow({
    getSettings: async () => {
      try {
        return (await services?.settings?.get()) ?? null
      } catch {
        // corrupt/missing settings fall back to visual defaults inside the window
        return null
      }
    },
  })
  const isOverlayTrustedSender = (contents: WebContents) =>
    contents === overlayWindowInstance?.getWindow()?.webContents
  wireOverlayControl({ overlayWindow: overlayWindowInstance, isOverlayTrustedSender })

  try {
    services = await createServiceController({
      dataDir: app.getPath('userData'),
      safeStorage,
      douyinLiveBinaryPath: resolveAssetBinary('douyinLive'),
      qdrantBinaryPath: resolveAssetBinary('qdrant'),
      migrations: [
        {
          version: 1,
          path: resolveResourcePath(join('docs', '06-data-interface', 'migrations', '001_initial_schema.sql')),
        },
        {
          version: 2,
          path: resolveResourcePath(join('docs', '06-data-interface', 'migrations', '002_queue_timeout_reason.sql')),
        },
      ],
      qdrantConfigTemplatePath: resolveResourcePath(join('resources', 'qdrant-config.yaml')),
      sidecarPins: {
        qdrant: {
          version: SIDECAR_PINS.qdrant.version,
          sha256: sidecarSha256('qdrant'),
        },
        douyinLive: {
          version: SIDECAR_PINS.douyinLive.version,
          sha256: sidecarSha256('douyinLive'),
        },
      },
      keyVersion: '1',
      displaySink: createOverlayDisplaySink({ overlayWindow: overlayWindowInstance }),
      cleanupOnStop: () => {
        overlayWindowInstance?.hideSuggestion()
      },
      logger,
    })
    logger.info('lifecycle', 'service controller ready')
    services.goldenSync.start()
    // WP-1 observability (TD-03): loopback /metrics endpoint + monitoring IPC.
    services.metricsHub.startServer()
    wireMonitoringControl({ metricsHub: services.metricsHub, isTrustedSender })
    // WP-3 audit retention: prune once per day, on the day's first run (service
    // is STOPPED at boot, so isStopped() is true). Best-effort, never fatal.
    const retention = new RetentionScheduler({
      audit: services.audit,
      settings: services.settings,
      statePath: join(app.getPath('userData'), 'config', 'retention-state.json'),
      isStopped: () =>
        services?.stateMachine.getViewState().lifecycle === 'STOPPED' &&
        !services?.controller.isStarting(),
      log: (message) => logger.info('storage', message),
    })
    void retention.runOnce().catch((err) => {
      logger.error('storage', `retention prune failed: ${err instanceof Error ? err.message : String(err)}`)
    })
    // RUNBOOK §3.2: the Qdrant loopback sidecar is a boot-time init step. A start
    // failure is non-fatal here — the gate stays fail-closed and retrieval
    // getStatus reports the sidecar as unavailable instead of crashing the app.
    void services.qdrant.start().catch((err) => {
      const code =
        typeof (err as { code?: unknown } | null)?.code === 'string'
          ? (err as { code: string }).code
          : undefined
      logger.error('storage', `qdrant sidecar start failed: ${err instanceof Error ? err.message : String(err)}`, code)
    })
    // Log lifecycle transitions (and every recorded recoverable error, which is
    // how a repeated start attempt fails while already STOPPED). Activity ticks
    // inside RUNNING are skipped so a busy session does not flood the file.
    let lastLoggedLifecycle: string | null = null
    services.stateMachine.onChanged((state) => {
      services?.diagnostics.updateLifecycle(state.lifecycle, state.activity)
      const lifecycleChanged = state.lifecycle !== lastLoggedLifecycle
      if (!lifecycleChanged && state.recoverableError === undefined) return
      lastLoggedLifecycle = state.lifecycle
      if (state.recoverableError !== undefined) {
        logger.error(
          'lifecycle',
          `service lifecycle -> ${state.lifecycle} (stopReason=${state.stopReason})`,
          state.recoverableError.code,
        )
      } else if (lifecycleChanged) {
        logger.info(
          'lifecycle',
          `service lifecycle -> ${state.lifecycle}${state.stopReason !== undefined ? ` (stopReason=${state.stopReason})` : ''}`,
        )
      }
    })
    wireStateBroadcast({ stateMachine: services.stateMachine, isTrustedSender })
    wireServiceControl({ controller: services.controller, isTrustedSender })
    wireProviderControl({ configService: services.providerConfig, isTrustedSender })
    wireConfigControl({
      settings: services.settings,
      providerConfig: services.providerConfig,
      overlayWindow: overlayWindowInstance,
      isTrustedSender,
      // WP-5: in-app data-root relocation. Services must be stopped before the
      // copy; after a successful migrate the app relaunches on the new root.
      moveDataRoot: {
        pointerStore: new DataLocationStore(
          join(dirname(app.getPath('appData')), 'Local', 'Echocue', 'data-location.json'),
        ),
        dataDir: app.getPath('userData'),
        // Packaged: getAppPath() is <install>\resources\app.asar, which would not
        // reject the real install root; the exe's dir is the true install base.
        installDir: dirname(app.getPath('exe')),
        isServiceStopped: () =>
          services?.stateMachine.getViewState().lifecycle === 'STOPPED' &&
          !services?.controller.isStarting(),
        shutdownServices: async () => {
          await services?.controller.stop()
          await services?.qdrant?.stop()
          services?.shutdown()
        },
        relaunch: () => {
          app.relaunch()
          app.quit()
        },
      },
    })
    wirePersonaControl({ persona: services.persona, isTrustedSender })
    wireSafetyControl({ safety: services.safety, isTrustedSender })
    wireAuditControl({
      audit: services.audit,
      isTrustedSender,
      // M7-02: reflux immediately after a label commits (fire-and-forget).
      onLabelSubmitted: () => {
        void services?.goldenSync?.processPending()
      },
    })
    wireDiagnosticsControl({ diagnostics: services.diagnostics, isTrustedSender })
    wireRetrievalControl({
      qdrant: services.qdrant,
      qdrantClient: services.qdrantClient,
      isTrustedSender,
      // Import is only legal when truly idle: the lifecycle stays STOPPED through
      // the gate phase, so also consult controller.isStarting() to close the
      // import-vs-start race (RUNBOOK §8.2).
      isServiceStopped: () =>
        services?.stateMachine.getViewState().lifecycle === 'STOPPED' &&
        !services?.controller.isStarting(),
      // WP-10: reject pre_set entries containing configured risk keywords.
      getRiskFilter: async () => {
        try {
          return compileRiskFilter((await services?.settings.get())?.riskFilter?.types ?? [])
        } catch {
          return null
        }
      },
    })
  } catch (err) {
    // bootstrap failure keeps the app usable; the gate fails closed until stores assemble
    console.error('service bootstrap failed', err)
  }

  trayManager = new TrayManager({
    onShow: showMainWindow,
    onQuit: doQuit,
  })

  // T-PKG-001 install-verify hook: by this point bootstrap (if it can succeed)
  // has run and windows/tray exist. Trigger the same graceful-exit path the tray
  // uses, then quit. Only fires when the flag is explicitly passed to the app.
  if (process.argv.includes('--smoke-quit')) {
    setTimeout(() => {
      void doQuit()
    }, SMOKE_QUIT_DELAY_MS)
  }
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
