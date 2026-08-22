import { ipcMain, type WebContents } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { createGuardedHandler } from '../ipc/guarded-handler.js';
import type { ProviderConfigService } from './provider-config.js';
import { createProviderCredentialHandlers } from './provider-control-handlers.js';

export interface ProviderControlIpcOptions {
  configService: ProviderConfigService;
  isTrustedSender: (contents: WebContents) => boolean;
}

// CONTRACT §7: provider.credential.set/clear/test from the main window only.
// Responses never contain the API key itself. Channel policy stays here; the
// credential logic is delegated to createProviderCredentialHandlers for testing.
export function wireProviderControl(options: ProviderControlIpcOptions): void {
  const { configService, isTrustedSender } = options;
  const handlers = createProviderCredentialHandlers(configService);

  ipcMain.handle(IpcChannel.ProviderCredentialSet, createGuardedHandler(isTrustedSender, (raw) => handlers.set(raw)));
  ipcMain.handle(IpcChannel.ProviderCredentialClear, createGuardedHandler(isTrustedSender, (raw) => handlers.clear(raw)));
  ipcMain.handle(IpcChannel.ProviderCredentialTest, createGuardedHandler(isTrustedSender, () => handlers.test()));
}
