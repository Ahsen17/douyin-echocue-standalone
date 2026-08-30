import { describe, expect, it, vi } from 'vitest';
import type { OverlayDisplayPayloadV1 } from '@echocue/contracts';
import { createHistoryAwareSink, type HistoryController } from '../../../src/main/history/index.js';
import type { SuggestionDisplaySink } from '../../../src/main/suggestion/index.js';

const PAYLOAD: OverlayDisplayPayloadV1 = {
  comment: { nickname: '观众A', text: '主播晚上好' },
  suggestion: { quickReply: '谢谢你', cues: ['接住夸奖', '继续互动'], source: 'llm' },
};

function fakeHistory(): HistoryController {
  return {
    record: vi.fn(),
    clear: vi.fn(),
    getSnapshot: vi.fn(),
    applyCapacity: vi.fn(),
    applyVisualPrefs: vi.fn(),
    destroy: vi.fn(),
  } as unknown as HistoryController;
}

const META = { sessionId: 's', traceId: 't', windowVersion: 1 };

describe('createHistoryAwareSink', () => {
  it('records the payload only when the inner sink shows successfully', async () => {
    const history = fakeHistory();
    const inner: SuggestionDisplaySink = {
      show: vi.fn().mockResolvedValue({ ok: true as const, firstFrameAtMonotonicMs: 123 }),
      hide: vi.fn(),
    };
    const sink = createHistoryAwareSink(inner, history);
    const result = await sink.show(PAYLOAD, META);
    expect(result).toEqual({ ok: true, firstFrameAtMonotonicMs: 123 });
    expect(history.record).toHaveBeenCalledWith(PAYLOAD);
  });

  it('does not record when the inner sink fails or is ignored', async () => {
    const history = fakeHistory();
    const inner: SuggestionDisplaySink = {
      show: vi.fn().mockResolvedValue({ ok: false as const, reason: 'OVERLAY_ACK_TIMEOUT' }),
      hide: vi.fn(),
    };
    const sink = createHistoryAwareSink(inner, history);
    const result = await sink.show(PAYLOAD, META);
    expect(result).toEqual({ ok: false, reason: 'OVERLAY_ACK_TIMEOUT' });
    expect(history.record).not.toHaveBeenCalled();
  });

  it('records nothing when the inner sink rejects', async () => {
    const history = fakeHistory();
    const inner: SuggestionDisplaySink = {
      show: vi.fn().mockRejectedValue(new Error('overlay destroyed')),
      hide: vi.fn(),
    };
    const sink = createHistoryAwareSink(inner, history);
    await expect(sink.show(PAYLOAD, META)).rejects.toThrow('overlay destroyed');
    expect(history.record).not.toHaveBeenCalled();
  });

  it('forwards hide to the inner sink', async () => {
    const history = fakeHistory();
    const inner: SuggestionDisplaySink = {
      show: vi.fn(),
      hide: vi.fn().mockResolvedValue(undefined),
    };
    const sink = createHistoryAwareSink(inner, history);
    await sink.hide();
    expect(inner.hide).toHaveBeenCalledTimes(1);
  });
});
