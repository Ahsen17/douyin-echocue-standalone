import { ipcMain, type WebContents } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { createGuardedHandler } from '../ipc/guarded-handler.js';
import type { AuditStoreWorker } from '../storage/index.js';
import { createAuditControlHandlers } from './audit-control-handlers.js';

export interface AuditControlIpcOptions {
  audit: AuditStoreWorker;
  isTrustedSender: (contents: WebContents) => boolean;
}

// CONTRACT §7: audit.search / audit.getWorkflow from the main window only.
// The overlay preload has no audit.* surface; a wrong sender is rejected by the
// guarded handler before any query runs.
export function wireAuditControl(options: AuditControlIpcOptions): void {
  const { audit, isTrustedSender } = options;
  const handlers = createAuditControlHandlers({ audit });

  ipcMain.handle(
    IpcChannel.AuditSearch,
    createGuardedHandler(isTrustedSender, (raw) => handlers.search(raw)),
  );
  ipcMain.handle(
    IpcChannel.AuditGetWorkflow,
    createGuardedHandler(isTrustedSender, (raw) => handlers.getWorkflow(raw)),
  );
  ipcMain.handle(
    IpcChannel.AuditSubmitLabel,
    createGuardedHandler(isTrustedSender, (raw) => handlers.submitLabel(raw)),
  );
}
