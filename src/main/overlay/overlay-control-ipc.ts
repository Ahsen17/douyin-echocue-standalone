import { ipcMain, type WebContents } from 'electron';
import { OverlayAckRequestV1Schema } from '@echocue/contracts';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { createGuardedHandler } from '../ipc/guarded-handler.js';
import type { OverlayWindow } from '../windows/OverlayWindow.js';

export interface OverlayControlIpcOptions {
  overlayWindow: OverlayWindow;
  isOverlayTrustedSender: (contents: WebContents) => boolean;
}

// CONTRACT §7: the overlay renderer's only request channel is the first-frame
// ack — no config/audit/service access, and the sender must be the overlay
// window itself.
export function wireOverlayControl(options: OverlayControlIpcOptions): void {
  const { overlayWindow, isOverlayTrustedSender } = options;
  ipcMain.handle(
    IpcChannel.OverlayAck,
    createGuardedHandler(isOverlayTrustedSender, (raw) => {
      const parsed = OverlayAckRequestV1Schema.safeParse(raw);
      if (!parsed.success) throw new Error('overlay ack payload invalid');
      overlayWindow.ack(parsed.data.requestId);
    }),
  );
}
