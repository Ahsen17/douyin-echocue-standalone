import { ipcMain, type WebContents } from 'electron';
import type { OverlayPreferenceV1 } from '@echocue/contracts';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { createGuardedHandler } from '../ipc/guarded-handler.js';
import type { SettingsStore } from './SettingsStore.js';
import type { ProviderConfigService } from '../provider/provider-config.js';
import { createConfigControlHandlers } from './config-control-handlers.js';

export interface ConfigControlIpcOptions {
  settings: SettingsStore;
  providerConfig: ProviderConfigService;
  isTrustedSender: (contents: WebContents) => boolean;
  /** M6-07 live-apply: re-applies visual prefs to the overlay window on update. */
  overlayWindow?: { applyPreferences(prefs: OverlayPreferenceV1): Promise<void> };
}

// CONTRACT §7: config.get/update + overlay.preference.update from the main
// window only. Responses are the renderer view (no internalRetrieval, key only
// as a boolean).
export function wireConfigControl(options: ConfigControlIpcOptions): void {
  const { settings, providerConfig, isTrustedSender, overlayWindow } = options;
  const handlers = createConfigControlHandlers({ settings, providerConfig, overlayWindow });

  ipcMain.handle(IpcChannel.ConfigGet, createGuardedHandler(isTrustedSender, () => handlers.get()));
  ipcMain.handle(IpcChannel.ConfigUpdate, createGuardedHandler(isTrustedSender, (raw) => handlers.update(raw)));
  ipcMain.handle(IpcChannel.OverlayPreferenceUpdate, createGuardedHandler(isTrustedSender, (raw) => handlers.updateOverlay(raw)));
}
