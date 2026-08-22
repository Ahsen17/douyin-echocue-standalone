import { ipcMain, type WebContents } from 'electron';
import type { ServiceViewState } from '@echocue/contracts';
import { IpcChannel } from '../../shared/ipc-channels.js';
import type { ServiceStateMachine } from './ServiceStateMachine.js';

export interface StateBroadcastOptions {
  stateMachine: ServiceStateMachine;
  isTrustedSender: (contents: WebContents) => boolean;
}

// CONTRACT §7: renderer subscribes via `service.state.subscribe`, receives
// `service.state.changed`; main auto-unregisters when the window is destroyed.
// The subscribe handler needs the event's sender to register the subscriber,
// so it keeps an explicit guard instead of createGuardedHandler.
export function wireStateBroadcast(options: StateBroadcastOptions): void {
  const { stateMachine, isTrustedSender } = options;
  const subscribers = new Set<WebContents>();

  stateMachine.onChanged((state) => broadcast(state));

  ipcMain.handle(IpcChannel.ServiceStateSubscribe, (event) => {
    if (!isTrustedSender(event.sender)) {
      throw new Error('rejected: untrusted sender');
    }
    subscribers.add(event.sender);
    event.sender.once('destroyed', () => subscribers.delete(event.sender));
    event.sender.send(IpcChannel.ServiceStateChanged, stateMachine.getViewState());
    return true;
  });

  function broadcast(state: ServiceViewState): void {
    for (const contents of subscribers) {
      if (!contents.isDestroyed()) contents.send(IpcChannel.ServiceStateChanged, state);
    }
  }
}
