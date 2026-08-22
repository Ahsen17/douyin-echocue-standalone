import { ipcMain, type WebContents } from 'electron';
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

  ipcMain.handle('provider.credential.set', async (event, raw: unknown) => {
    if (!isTrustedSender(event.sender)) {
      throw new Error('provider.credential.set rejected: untrusted sender');
    }
    return handlers.set(raw);
  });

  ipcMain.handle('provider.credential.clear', async (event, raw: unknown) => {
    if (!isTrustedSender(event.sender)) {
      throw new Error('provider.credential.clear rejected: untrusted sender');
    }
    return handlers.clear(raw);
  });

  ipcMain.handle('provider.credential.test', async (event) => {
    if (!isTrustedSender(event.sender)) {
      throw new Error('provider.credential.test rejected: untrusted sender');
    }
    return handlers.test();
  });
}
