import { ipcMain, type WebContents } from 'electron';
import type { OverlayPreferenceV1 } from '@echocue/contracts';
import { MoveDataRootRequestV1Schema } from '@echocue/contracts';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { createGuardedHandler } from '../ipc/guarded-handler.js';
import type { SettingsStore } from './SettingsStore.js';
import type { ProviderConfigService } from '../provider/provider-config.js';
import { DataLocationStore, moveDataRoot, validateMoveDataRoot } from './DataLocationStore.js';
import { createConfigControlHandlers } from './config-control-handlers.js';

export interface MoveDataRootContext {
  pointerStore: DataLocationStore;
  dataDir: string;
  installDir: string;
  /** Migration is only legal while the service is truly stopped (RUNBOOK §8.2). */
  isServiceStopped: () => boolean;
  /** Close stores + sidecars so no process holds a file lock on the data root. */
  shutdownServices: () => Promise<void>;
  /** Relaunch the app so the new root takes effect on boot. */
  relaunch: () => void | Promise<void>;
}

export interface ConfigControlIpcOptions {
  settings: SettingsStore;
  providerConfig: ProviderConfigService;
  isTrustedSender: (contents: WebContents) => boolean;
  /** M6-07 live-apply: re-applies visual prefs to the overlay window on update. */
  overlayWindow?: { applyPreferences(prefs: OverlayPreferenceV1): Promise<void> };
  /** WP-5: in-app data-root relocation (settings.moveDataRoot). */
  moveDataRoot?: MoveDataRootContext;
}

// CONTRACT §7: config.get/update + overlay.preference.update from the main
// window only. Responses are the renderer view (no internalRetrieval, key only
// as a boolean). settings.moveDataRoot relocates the whole data root then quits.
export function wireConfigControl(options: ConfigControlIpcOptions): void {
  const { settings, providerConfig, isTrustedSender, overlayWindow, moveDataRoot: moveCtx } = options;
  const handlers = createConfigControlHandlers({ settings, providerConfig, overlayWindow });

  ipcMain.handle(IpcChannel.ConfigGet, createGuardedHandler(isTrustedSender, () => handlers.get()));
  ipcMain.handle(IpcChannel.ConfigUpdate, createGuardedHandler(isTrustedSender, (raw) => handlers.update(raw)));
  // WP-5 read-only: the effective data root (where audit/settings/qdrant live).
  // Returns null when the migration context is absent (dev mode).
  ipcMain.handle(
    IpcChannel.ConfigGetDataRoot,
    createGuardedHandler(isTrustedSender, () => moveCtx?.dataDir ?? null),
  );
  ipcMain.handle(IpcChannel.OverlayPreferenceUpdate, createGuardedHandler(isTrustedSender, (raw) => handlers.updateOverlay(raw)));
  ipcMain.handle(
    IpcChannel.SettingsMoveDataRoot,
    createGuardedHandler(isTrustedSender, async (raw) => {
      if (moveCtx === undefined) {
        throw new Error('数据迁移未启用');
      }
      const parsed = MoveDataRootRequestV1Schema.safeParse(raw);
      if (!parsed.success) {
        throw new Error('迁移目标不合法');
      }
      if (!moveCtx.isServiceStopped()) {
        throw new Error('服务运行中，请先停止服务后再迁移数据');
      }
      const targetDir = parsed.data.targetDir;
      const validation = await validateMoveDataRoot(moveCtx.dataDir, moveCtx.installDir, targetDir);
      if (!validation.ok) {
        throw new Error(validation.error);
      }
      await moveCtx.shutdownServices();
      const result = await moveDataRoot(moveCtx.dataDir, targetDir);
      if (!result.ok) {
        throw new Error(`迁移失败：${result.error}`);
      }
      await moveCtx.pointerStore.write(targetDir);
      // Relaunch so the new root is picked up at boot; quit returns normally only
      // when the app refuses to relaunch.
      await moveCtx.relaunch();
      return { ok: true };
    }),
  );
}
