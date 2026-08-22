import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '../../../src/shared/ipc-channels.js';
import { wireStateBroadcast } from '../../../src/main/service/state-broadcast.js';

const mocks = vi.hoisted(() => {
  const registered = new Map<string, (event: { sender: unknown }) => unknown>();
  const ipcMain = {
    handle: vi.fn(
      (channel: string, handler: (event: { sender: unknown }) => unknown) => {
        registered.set(channel, handler);
      },
    ),
  };
  return { registered, ipcMain };
});

vi.mock('electron', () => ({ ipcMain: mocks.ipcMain }));

const INITIAL = { lifecycle: 'STOPPED', activity: 'IDLE' };
const NEXT = { lifecycle: 'RUNNING', activity: 'LISTENING' };

function makeStateMachine() {
  let onChangeCb: ((state: unknown) => void) | undefined;
  const stateMachine = {
    onChanged: vi.fn((cb: (state: unknown) => void) => {
      onChangeCb = cb;
    }),
    getViewState: vi.fn(() => INITIAL),
    trigger: (state: unknown) => onChangeCb?.(state),
  };
  return stateMachine;
}

function makeSender() {
  return { once: vi.fn(), send: vi.fn(), isDestroyed: vi.fn(() => false) };
}

describe('wireStateBroadcast subscribe/broadcast (M6-11 / CONTRACT §7)', () => {
  beforeEach(() => {
    mocks.registered.clear();
    vi.clearAllMocks();
  });

  it('subscribes a trusted sender, pushes the initial state, and registers destroy cleanup', () => {
    const stateMachine = makeStateMachine();
    const sender = makeSender();
    wireStateBroadcast({ stateMachine: stateMachine as never, isTrustedSender: (c) => c === sender });
    const handler = mocks.registered.get(IpcChannel.ServiceStateSubscribe)!;
    const result = handler({ sender });
    expect(result).toBe(true);
    expect(stateMachine.onChanged).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(IpcChannel.ServiceStateChanged, INITIAL);
    expect(sender.once).toHaveBeenCalledWith('destroyed', expect.any(Function));
  });

  it('broadcasts the new state to subscribers when the machine state changes', () => {
    const stateMachine = makeStateMachine();
    const sender = makeSender();
    wireStateBroadcast({ stateMachine: stateMachine as never, isTrustedSender: (c) => c === sender });
    mocks.registered.get(IpcChannel.ServiceStateSubscribe)!({ sender });
    sender.send.mockClear();
    stateMachine.trigger(NEXT);
    expect(sender.send).toHaveBeenCalledWith(IpcChannel.ServiceStateChanged, NEXT);
  });

  it('auto-unregisters a subscriber when its window is destroyed', () => {
    const stateMachine = makeStateMachine();
    const sender = makeSender();
    wireStateBroadcast({ stateMachine: stateMachine as never, isTrustedSender: (c) => c === sender });
    mocks.registered.get(IpcChannel.ServiceStateSubscribe)!({ sender });
    sender.send.mockClear();
    const destroyedCb = sender.once.mock.calls[0][1] as () => void;
    destroyedCb();
    stateMachine.trigger(NEXT);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('skips broadcasting to a destroyed subscriber', () => {
    const stateMachine = makeStateMachine();
    const alive = makeSender();
    const gone = makeSender();
    gone.isDestroyed.mockReturnValue(true);
    wireStateBroadcast({
      stateMachine: stateMachine as never,
      isTrustedSender: (c) => c === alive || c === gone,
    });
    mocks.registered.get(IpcChannel.ServiceStateSubscribe)!({ sender: alive });
    mocks.registered.get(IpcChannel.ServiceStateSubscribe)!({ sender: gone });
    alive.send.mockClear();
    gone.send.mockClear();
    stateMachine.trigger(NEXT);
    expect(alive.send).toHaveBeenCalledWith(IpcChannel.ServiceStateChanged, NEXT);
    expect(gone.send).not.toHaveBeenCalled();
  });

  it('rejects an untrusted sender', () => {
    const stateMachine = makeStateMachine();
    const sender = makeSender();
    wireStateBroadcast({ stateMachine: stateMachine as never, isTrustedSender: (c) => c === sender });
    const handler = mocks.registered.get(IpcChannel.ServiceStateSubscribe)!;
    expect(() => handler({ sender: { id: 99 } })).toThrow(/rejected: untrusted sender/);
  });
});
