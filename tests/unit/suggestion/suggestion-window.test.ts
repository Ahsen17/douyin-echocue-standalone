import { describe, expect, it } from 'vitest';
import { SuggestionWindow } from '../../../src/main/suggestion/index.js';
import type { PendingCandidate } from '../../../src/main/suggestion/index.js';

function candidate(id: string, priority: number, receivedAt: number): PendingCandidate {
  return {
    traceId: `trace-${id}`,
    sourceMessageId: `msg-${id}`,
    receivedMonotonicMs: receivedAt,
    priority,
    processingComment: {
      sourceMessageId: `msg-${id}`,
      rawEvent: {},
      rawText: `msg-${id}`,
      normalizedText: `msg-${id}`,
      receivedAt: '2026-08-22T00:00:00.000Z',
      receivedMonotonicMs: receivedAt,
      sessionId: 's1',
      traceId: `trace-${id}`,
      windowVersion: 1,
      freshnessDeadlineMonotonicMs: receivedAt + 3000,
    },
    personaRoute: {} as never,
    personaSnapshot: {
      personaId: 'p-1',
      personaVersion: 'v1',
      nickname: '主播A',
      content: 'content',
      contentHmac: 'hmac',
    },
    safetySnapshot: { version: 'v1', policyText: '', keywords: [] },
    calibrated: { mergedTopK: [], goldenHits: [], preHits: [], calibrationVersion: 'v1', semanticDecision: { action: 'CANDIDATE', topSemanticType: 'low_value' } },
  };
}

describe('SuggestionWindow', () => {
  it('selects the highest-priority candidate', () => {
    const window = new SuggestionWindow({ windowMaxAgeMs: 1500, candidateMaxCount: 50 });
    window.add(candidate('low', 0.3, 100), 100);
    window.add(candidate('high', 0.9, 200), 200);
    expect(window.selectBest(300)?.traceId).toBe('trace-high');
  });

  it('evicts expired candidates by age', () => {
    const window = new SuggestionWindow({ windowMaxAgeMs: 1000, candidateMaxCount: 50 });
    window.add(candidate('old', 0.9, 0), 0);
    expect(window.selectBest(500)?.traceId).toBe('trace-old');
    expect(window.selectBest(1500)).toBeNull();
  });

  it('caps candidates by count, dropping the lowest priority', () => {
    const window = new SuggestionWindow({ windowMaxAgeMs: 10000, candidateMaxCount: 2 });
    window.add(candidate('a', 0.1, 0), 0);
    window.add(candidate('b', 0.5, 1), 1);
    window.add(candidate('c', 0.9, 2), 2);
    expect(window.size).toBe(2);
    const best = window.selectBest(100);
    expect(best?.traceId).toBe('trace-c');
  });

  it('clears and bumps the version on display end', () => {
    const window = new SuggestionWindow({ windowMaxAgeMs: 10000, candidateMaxCount: 50 });
    window.add(candidate('a', 0.9, 0), 0);
    expect(window.version).toBe(0);
    window.clear();
    window.bumpVersion();
    expect(window.size).toBe(0);
    expect(window.version).toBe(1);
  });

  it('reports every eviction via onEvict (age, cap, clear)', () => {
    const evicted: string[] = [];
    const window = new SuggestionWindow({
      windowMaxAgeMs: 1000,
      candidateMaxCount: 2,
      onEvict: (traceId) => evicted.push(traceId),
    });
    // cap eviction
    window.add(candidate('a', 0.1, 0), 0);
    window.add(candidate('b', 0.5, 1), 1);
    window.add(candidate('c', 0.9, 2), 2);
    expect(evicted).toContain('trace-a');
    // age eviction
    window.selectBest(5000);
    expect(evicted).toContain('trace-b');
    expect(evicted).toContain('trace-c');
    // clear eviction
    window.add(candidate('d', 0.9, 0), 0);
    window.clear();
    expect(evicted).toContain('trace-d');
  });

  it('does not report removal of a selected candidate', () => {
    const evicted: string[] = [];
    const window = new SuggestionWindow({
      windowMaxAgeMs: 10000,
      candidateMaxCount: 50,
      onEvict: (traceId) => evicted.push(traceId),
    });
    window.add(candidate('a', 0.9, 0), 0);
    window.removeSelected('trace-a');
    expect(evicted).not.toContain('trace-a');
    expect(window.size).toBe(0);
  });
});
