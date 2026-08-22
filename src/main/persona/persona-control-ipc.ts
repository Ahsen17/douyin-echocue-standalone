import { ipcMain, type WebContents } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { createGuardedHandler } from '../ipc/guarded-handler.js';
import type { PersonaStore } from './PersonaStore.js';
import { createPersonaControlHandlers } from './persona-control-handlers.js';

export interface PersonaControlIpcOptions {
  persona: PersonaStore;
  isTrustedSender: (contents: WebContents) => boolean;
}

// CONTRACT §7: persona.list from the main window only. M6-04 extends this to
// the full persona.* channel set.
export function wirePersonaControl(options: PersonaControlIpcOptions): void {
  const { persona, isTrustedSender } = options;
  const handlers = createPersonaControlHandlers({ persona });

  ipcMain.handle(IpcChannel.PersonaList, createGuardedHandler(isTrustedSender, () => handlers.list()));
}
