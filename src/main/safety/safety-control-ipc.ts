import { ipcMain, type WebContents } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { createGuardedHandler } from '../ipc/guarded-handler.js';
import type { SafetyPolicyStore } from './SafetyPolicyStore.js';
import { createSafetyControlHandlers } from './safety-control-handlers.js';

export interface SafetyControlIpcOptions {
  safety: SafetyPolicyStore;
  isTrustedSender: (contents: WebContents) => boolean;
}

// CONTRACT §7: safety.* from the main window only. Responses carry policy text,
// keywords and compile validation results; compiled rules never cross.
export function wireSafetyControl(options: SafetyControlIpcOptions): void {
  const { safety, isTrustedSender } = options;
  const handlers = createSafetyControlHandlers({ safety });

  ipcMain.handle(IpcChannel.SafetyGet, createGuardedHandler(isTrustedSender, () => handlers.get()));
  ipcMain.handle(IpcChannel.SafetySaveDraft, createGuardedHandler(isTrustedSender, (raw) => handlers.saveDraft(raw)));
  ipcMain.handle(IpcChannel.SafetyPublish, createGuardedHandler(isTrustedSender, (raw) => handlers.publish(raw)));
}
