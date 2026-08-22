import { ipcMain, type WebContents } from 'electron';
import type { ServiceController } from './ServiceController.js';

export interface ServiceControlIpcOptions {
  controller: ServiceController;
  isTrustedSender: (contents: WebContents) => boolean;
}

// CONTRACT §7: service.start/stop from the main window only.
export function wireServiceControl(options: ServiceControlIpcOptions): void {
  const { controller, isTrustedSender } = options;

  ipcMain.handle('service.start', (event) => {
    if (!isTrustedSender(event.sender)) {
      throw new Error('service.start rejected: untrusted sender');
    }
    return controller.start();
  });

  ipcMain.handle('service.stop', (event) => {
    if (!isTrustedSender(event.sender)) {
      throw new Error('service.stop rejected: untrusted sender');
    }
    return controller.stop();
  });
}
