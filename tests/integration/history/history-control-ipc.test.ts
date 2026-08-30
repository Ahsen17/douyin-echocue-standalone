import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '../../../src/shared/ipc-channels.js';
import { createHistoryController, wireHistoryControl } from '../../../src/main/history/index.js';

const mocks = vi.hoisted(() => {
  const registered = new Map<string, (event: { sender: unknown }, raw?: unknown) => unknown>();
  const ipcMain = {
    handle: vi.fn(
      (channel: string, handler: (event: { sender: unknown }, raw?: unknown) => unknown) => {
        registered.set(channel, handler);
      },
    ),
  };
  return { registered, ipcMain };
});

vi.mock('electron', () => ({ ipcMain: mocks.ipcMain }));

describe('history control IPC (CONTRACT §7)', () => {
  beforeEach(() => {
    mocks.registered.clear();
    vi.clearAllMocks();
  });

  function setup() {
    const sent: unknown[] = [];
    const history = createHistoryController({
      window: {
        isReady: () => true,
        send: (_channel, payload) => {
          sent.push(payload);
        },
      },
      formatDisplayedAt: () => '20:00:00',
    });
    const historyWc = { id: 1 };
    wireHistoryControl({ history, isHistoryTrustedSender: (contents) => contents === historyWc });
    return { history, historyWc, sent };
  }

  it('registers only the history.getSnapshot request channel', () => {
    setup();
    expect([...mocks.registered.keys()]).toEqual([IpcChannel.HistoryGetSnapshot]);
  });

  it('rejects an untrusted sender before reaching the controller', () => {
    setup();
    const handler = mocks.registered.get(IpcChannel.HistoryGetSnapshot);
    expect(handler).toBeDefined();
    expect(() => handler!({ sender: { id: 99 } })).toThrow(/rejected: untrusted sender/);
  });

  it('returns the current snapshot for a trusted sender', () => {
    const { history, historyWc } = setup();
    history.record({
      comment: { nickname: '观众A', text: '主播晚上好' },
      suggestion: { quickReply: '谢谢你', cues: ['接住夸奖', '继续互动'], source: 'llm' },
    });
    const handler = mocks.registered.get(IpcChannel.HistoryGetSnapshot)!;
    const snap = handler({ sender: historyWc });
    expect(snap).toEqual({
      entries: [expect.objectContaining({ displayedAt: '20:00:00' })],
      capacity: 20,
    });
  });

  it('a recorded entry is also pushed to the window as a full snapshot', () => {
    const { history, sent } = setup();
    history.record({
      comment: { text: '主播晚上好' },
      suggestion: { quickReply: '谢谢你', cues: ['接住夸奖', '继续互动'], source: 'llm' },
    });
    expect(sent).toEqual([
      {
        entries: [expect.objectContaining({ comment: { text: '主播晚上好' } })],
        capacity: 20,
      },
    ]);
  });
});
