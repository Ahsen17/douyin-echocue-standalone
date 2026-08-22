import { ipcMain, type WebContents } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { createGuardedHandler } from '../ipc/guarded-handler.js';
import type { ServiceController } from './ServiceController.js';

export interface ServiceControlIpcOptions {
  controller: ServiceController;
  isTrustedSender: (contents: WebContents) => boolean;
}

// CONTRACT §7: service.start/stop from the main window only.
export function wireServiceControl(options: ServiceControlIpcOptions): void {
  const { controller, isTrustedSender } = options;

  ipcMain.handle(IpcChannel.ServiceStart, createGuardedHandler(isTrustedSender, () => controller.start()));

  ipcMain.handle(IpcChannel.ServiceStop, createGuardedHandler(isTrustedSender, () => controller.stop()));
}
