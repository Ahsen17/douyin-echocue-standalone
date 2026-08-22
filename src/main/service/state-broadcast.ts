import { ipcMain, type WebContents } from 'electron';
import type { ServiceViewState } from '@echocue/contracts';
import type { ServiceStateMachine } from './ServiceStateMachine.js';

export interface StateBroadcastOptions {
  stateMachine: ServiceStateMachine;
  isTrustedSender: (contents: WebContents) => boolean;
}

// CONTRACT §7: renderer subscribes via `service.state.subscribe`, receives
// `service.state.changed`; main auto-unregisters when the window is destroyed.
export function wireStateBroadcast(options: StateBroadcastOptions): void {
  const { stateMachine, isTrustedSender } = options;
  const subscribers = new Set<WebContents>();

  stateMachine.onChanged((state) => broadcast(state));

  ipcMain.handle('service.state.subscribe', (event) => {
    if (!isTrustedSender(event.sender)) {
      throw new Error('service.state.subscribe rejected: untrusted sender');
    }
    subscribers.add(event.sender);
    event.sender.once('destroyed', () => subscribers.delete(event.sender));
    event.sender.send('service.state.changed', stateMachine.getViewState());
    return true;
  });

  function broadcast(state: ServiceViewState): void {
    for (const contents of subscribers) {
      if (!contents.isDestroyed()) contents.send('service.state.changed', state);
    }
  }
}
