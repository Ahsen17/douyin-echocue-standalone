import { ipcMain, type WebContents } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { createGuardedHandler } from '../ipc/guarded-handler.js';
import type { HistoryController } from './history-controller.js';

export interface HistoryControlIpcOptions {
  history: HistoryController;
  isHistoryTrustedSender: (contents: WebContents) => boolean;
}

// CONTRACT §7: the history renderer's only request channel is the mount-time
// snapshot; the sender must be the history window itself. Every mutation arrives
// as a main-pushed HistorySnapshotChanged event — no renderer-initiated writes.
export function wireHistoryControl(options: HistoryControlIpcOptions): void {
  const { history, isHistoryTrustedSender } = options;
  ipcMain.handle(
    IpcChannel.HistoryGetSnapshot,
    createGuardedHandler(isHistoryTrustedSender, () => history.getSnapshot()),
  );
}
