import { ipcMain, type WebContents } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { createGuardedHandler } from '../ipc/guarded-handler.js';
import type { PersonaStore } from './PersonaStore.js';
import { createPersonaControlHandlers } from './persona-control-handlers.js';

export interface PersonaControlIpcOptions {
  persona: PersonaStore;
  isTrustedSender: (contents: WebContents) => boolean;
}

// CONTRACT §7: persona.* from the main window only. Responses are summaries and
// version metadata; persona content never crosses this boundary (M6-04).
export function wirePersonaControl(options: PersonaControlIpcOptions): void {
  const { persona, isTrustedSender } = options;
  const handlers = createPersonaControlHandlers({ persona });

  ipcMain.handle(IpcChannel.PersonaList, createGuardedHandler(isTrustedSender, () => handlers.list()));
  ipcMain.handle(IpcChannel.PersonaGet, createGuardedHandler(isTrustedSender, (raw) => handlers.get(raw)));
  ipcMain.handle(IpcChannel.PersonaCreate, createGuardedHandler(isTrustedSender, (raw) => handlers.create(raw)));
  ipcMain.handle(IpcChannel.PersonaDelete, createGuardedHandler(isTrustedSender, (raw) => handlers.delete(raw)));
  ipcMain.handle(IpcChannel.PersonaSetPrincipal, createGuardedHandler(isTrustedSender, (raw) => handlers.setPrincipal(raw)));
  ipcMain.handle(IpcChannel.PersonaSaveDraft, createGuardedHandler(isTrustedSender, (raw) => handlers.saveDraft(raw)));
  ipcMain.handle(IpcChannel.PersonaPublish, createGuardedHandler(isTrustedSender, (raw) => handlers.publish(raw)));
  ipcMain.handle(IpcChannel.PersonaListVersions, createGuardedHandler(isTrustedSender, (raw) => handlers.listVersions(raw)));
  ipcMain.handle(IpcChannel.PersonaCompare, createGuardedHandler(isTrustedSender, (raw) => handlers.compare(raw)));
  ipcMain.handle(IpcChannel.PersonaUpdateAliases, createGuardedHandler(isTrustedSender, (raw) => handlers.updateAliases(raw)));
}
