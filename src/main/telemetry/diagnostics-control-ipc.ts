import { ipcMain, type WebContents } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { createGuardedHandler } from '../ipc/guarded-handler.js';
import type { DiagnosticsSource } from './DiagnosticsSource.js';
import { createDiagnosticsControlHandlers } from './diagnostics-control-handlers.js';

export interface DiagnosticsControlIpcOptions {
  diagnostics: DiagnosticsSource;
  isTrustedSender: (contents: WebContents) => boolean;
}

// CONTRACT §7 (extended): diagnostics.getSummary from the main window only.
// UI §8.1 — the anonymous run summary, never raw content.
export function wireDiagnosticsControl(options: DiagnosticsControlIpcOptions): void {
  const { diagnostics, isTrustedSender } = options;
  const handlers = createDiagnosticsControlHandlers({ diagnostics });

  ipcMain.handle(
    IpcChannel.DiagnosticsGetSummary,
    createGuardedHandler(isTrustedSender, () => handlers.getSummary()),
  );
}
