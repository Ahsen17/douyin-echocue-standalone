import { describe, expect, it, vi } from 'vitest';
import type { OverlayDisplayPayloadV1 } from '@echocue/contracts';
import { createOverlayDisplaySink } from '../../../src/main/overlay/index.js';

const PAYLOAD: OverlayDisplayPayloadV1 = {
  comment: { nickname: '观众A', text: '主播晚上好' },
  suggestion: {
    quickReply: '谢谢你',
    cues: ['接住夸奖', '继续互动'],
    source: 'llm',
  },
};

const META = { sessionId: 's1', traceId: 'trace-secret', windowVersion: 1 };

function makeWindow(showResult: unknown) {
  const showSuggestion = vi.fn(async () => showResult);
  const hideSuggestion = vi.fn(async () => undefined);
  return {
    showSuggestion,
    hideSuggestion,
    instance: { showSuggestion, hideSuggestion } as never,
  };
}

describe('Overlay display sink (M6-07)', () => {
  it('forwards the payload and a fresh requestId to the window', async () => {
    const { showSuggestion, instance } = makeWindow({ ok: true, firstFrameAtMonotonicMs: 123 });
    const sink = createOverlayDisplaySink({ overlayWindow: instance });
    const result = await sink.show(PAYLOAD, META);
    expect(result).toEqual({ ok: true, firstFrameAtMonotonicMs: 123 });
    expect(showSuggestion).toHaveBeenCalledTimes(1);
    const [payloadArg, requestId] = showSuggestion.mock.calls[0] as [unknown, unknown];
    expect(payloadArg).toBe(PAYLOAD);
    expect(requestId).toEqual(expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/));
  });

  it('maps a window failure into the sink failure shape', async () => {
    const { instance } = makeWindow({ ok: false, reason: 'OVERLAY_ACK_TIMEOUT' });
    const sink = createOverlayDisplaySink({ overlayWindow: instance });
    await expect(sink.show(PAYLOAD, META)).resolves.toEqual({
      ok: false,
      reason: 'OVERLAY_ACK_TIMEOUT',
    });
  });

  it('delegates hide to the window', async () => {
    const { hideSuggestion, instance } = makeWindow({ ok: true, firstFrameAtMonotonicMs: 1 });
    const sink = createOverlayDisplaySink({ overlayWindow: instance });
    await sink.hide();
    expect(hideSuggestion).toHaveBeenCalledTimes(1);
  });

  it('never forwards meta (trace_id) to the window — only payload and requestId', async () => {
    const { showSuggestion, instance } = makeWindow({ ok: false, reason: 'x' });
    const sink = createOverlayDisplaySink({ overlayWindow: instance });
    await sink.show(PAYLOAD, META);
    const call = showSuggestion.mock.calls[0] as [unknown, unknown];
    expect(call).toHaveLength(2);
    expect(JSON.stringify(call[0])).not.toContain('trace-secret');
    expect(JSON.stringify(call[1])).not.toContain('trace-secret');
  });
});
