import { describe, it, expect } from 'vitest';
import type { DiagnosticSummaryV1 } from '@echocue/contracts';
import { formatRecentActivity } from '../../../src/renderer/main/run/recent-activity.js';

function summary(partial: Partial<DiagnosticSummaryV1> = {}): DiagnosticSummaryV1 {
  return { lifecycle: 'STOPPED', activity: 'IDLE', ...partial };
}

describe('formatRecentActivity (UI §4 recent-activity card)', () => {
  it('empty summary shows 暂无 for all fields', () => {
    const view = formatRecentActivity(summary());
    expect(view.lastReceived).toBe('暂无');
    expect(view.lastProcessed).toBe('暂无');
    expect(view.lastE2eMs).toBe('暂无');
  });

  it('formats received time from ISO', () => {
    const view = formatRecentActivity(summary({ lastCommentReceivedAt: '2026-08-22T12:00:00.000Z' }));
    expect(view.lastReceived).not.toBe('暂无');
    expect(view.lastReceived).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('maps result code to a label with time', () => {
    const view = formatRecentActivity(
      summary({
        lastSuggestionAt: '2026-08-22T12:00:05.000Z',
        lastSuggestionResult: 'displayed',
      }),
    );
    expect(view.lastProcessed).toContain('已展示');
    expect(view.lastProcessed).toMatch(/已展示 · \d{2}:\d{2}:\d{2}/);
  });

  it('formats e2e latency', () => {
    const view = formatRecentActivity(summary({ lastE2eLatencyMs: 1800 }));
    expect(view.lastE2eMs).toBe('1800 毫秒');
  });

  it('result without time stays 暂无', () => {
    const view = formatRecentActivity(summary({ lastSuggestionResult: 'filtered' }));
    expect(view.lastProcessed).toBe('暂无');
  });
});
