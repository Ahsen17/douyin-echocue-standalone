import { describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '../../../src/shared/ipc-channels.js';
import {
  createHistoryController,
  type HistoryControllerDeps,
  type HistoryWindowLike,
} from '../../../src/main/history/history-controller.js';
import type { HistorySnapshotV1, OverlayDisplayPayloadV1, OverlayPreferenceV1 } from '@echocue/contracts';

function payload(): OverlayDisplayPayloadV1 {
  return {
    comment: { nickname: '观众A', text: '主播晚上好', sentAt: '19:55:25' },
    suggestion: { quickReply: '谢谢你', cues: ['接住夸奖', '继续互动'], source: 'llm' },
  };
}

const PREFS: OverlayPreferenceV1 = {
  durationMs: 10_000,
  width: 800,
  height: 200,
  opacity: 0.95,
  fontScale: 1.1,
  theme: 'light',
  clickThrough: false,
};

function fakeWindow() {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const window: HistoryWindowLike = {
    isReady: vi.fn(() => true),
    send: vi.fn((channel: string, payload: unknown) => {
      sent.push({ channel, payload });
    }),
  };
  return { window, sent };
}

function pushes(sent: Array<{ channel: string; payload: unknown }>): HistorySnapshotV1[] {
  return sent
    .filter((s) => s.channel === IpcChannel.HistorySnapshotChanged)
    .map((s) => s.payload as HistorySnapshotV1);
}

describe('createHistoryController', () => {
  it('record appends one entry with a displayedAt timestamp and no trace fields', () => {
    const { window, sent } = fakeWindow();
    const history = createHistoryController({ window, formatDisplayedAt: () => '20:00:00' });
    history.record(payload());
    const last = pushes(sent).pop();
    expect(last?.entries).toHaveLength(1);
    const entry = last?.entries[0] as Record<string, unknown>;
    expect(entry.displayedAt).toBe('20:00:00');
    expect(entry.comment).toEqual(payload().comment);
    expect(entry.suggestion).toEqual(payload().suggestion);
    expect('traceId' in entry).toBe(false);
    expect('sessionId' in entry).toBe(false);
  });

  it('record pushes a full snapshot each time and prunes beyond capacity', () => {
    const { window, sent } = fakeWindow();
    const history = createHistoryController({ window, capacity: 2, formatDisplayedAt: () => '20:00:00' });
    history.record(payload());
    history.record(payload());
    history.record(payload());
    const snaps = pushes(sent);
    expect(snaps).toHaveLength(3);
    expect(snaps[2].entries).toHaveLength(2);
    expect(snaps[2].capacity).toBe(2);
  });

  it('does not push to a window that is not ready', () => {
    const window: HistoryWindowLike = { isReady: () => false, send: vi.fn() };
    const history = createHistoryController({ window });
    history.record(payload());
    history.clear();
    expect(window.send).not.toHaveBeenCalled();
  });

  it('clear empties the buffer and pushes an empty snapshot', () => {
    const { window, sent } = fakeWindow();
    const history = createHistoryController({ window, formatDisplayedAt: () => '20:00:00' });
    history.record(payload());
    history.clear();
    expect(pushes(sent).pop()?.entries).toEqual([]);
    expect(history.getSnapshot().entries).toEqual([]);
  });

  it('applyCapacity prunes the buffer and pushes the new capacity', () => {
    const { window, sent } = fakeWindow();
    const history = createHistoryController({ window, formatDisplayedAt: () => '20:00:00' });
    history.record(payload());
    history.record(payload());
    history.applyCapacity(1);
    const last = pushes(sent).pop();
    expect(last?.capacity).toBe(1);
    expect(last?.entries).toHaveLength(1);
  });

  it('applyVisualPrefs forwards the overlay prefs to the renderer', () => {
    const { sent } = fakeWindow();
    const history = createHistoryController({ window: { isReady: () => true, send: vi.fn((channel, payload) => sent.push({ channel, payload })) } });
    history.applyVisualPrefs(PREFS);
    expect(sent).toEqual([{ channel: IpcChannel.HistoryPreferenceChanged, payload: PREFS }]);
  });

  it('getSnapshot returns current entries and capacity', () => {
    const { window } = fakeWindow();
    const history = createHistoryController({ window, capacity: 5, formatDisplayedAt: () => '20:00:00' });
    history.record(payload());
    const snap = history.getSnapshot();
    expect(snap.capacity).toBe(5);
    expect(snap.entries).toHaveLength(1);
  });

  it('destroy clears the feed without pushing', () => {
    const { window, sent } = fakeWindow();
    const history = createHistoryController({ window, formatDisplayedAt: () => '20:00:00' });
    history.record(payload());
    sent.length = 0;
    history.destroy();
    expect(history.getSnapshot().entries).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('default displayedAt is a local HH:mm:ss string', () => {
    const { window, sent } = fakeWindow();
    const history = createHistoryController({ window });
    history.record(payload());
    const entry = pushes(sent).pop()?.entries[0] as { displayedAt: string };
    expect(entry.displayedAt).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
