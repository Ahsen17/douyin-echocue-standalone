import { describe, it, expect } from 'vitest'
import { SessionMetrics } from '../../../src/main/telemetry/SessionMetrics.js'

describe('SessionMetrics', () => {
  it('empty snapshot before any session', () => {
    const s = new SessionMetrics()
    expect(s.snapshot()).toMatchObject({
      commentReceived: 0,
      commentFiltered: 0,
      llmRequests: 0,
      displayed: 0,
    })
    expect(s.snapshot().sessionId).toBeUndefined()
  })

  it('records counts and semantic-type distribution for the live session', () => {
    const s = new SessionMetrics()
    s.reset('01932a3b-4c5d-7000-8000-0000000000aa')
    s.recordCommentReceived()
    s.recordCommentReceived()
    s.recordCommentFiltered()
    s.recordSemanticType('persona_relevant')
    s.recordSemanticType('persona_relevant')
    s.recordSemanticType('low_value')
    s.recordLlmRequest()
    s.recordSuggestionResult('displayed')
    s.recordSuggestionResult('discarded')
    const snap = s.snapshot()
    expect(snap.commentReceived).toBe(2)
    expect(snap.commentFiltered).toBe(1)
    expect(snap.semanticTypeCounts).toEqual({ persona_relevant: 2, low_value: 1 })
    expect(snap.llmRequests).toBe(1)
    expect(snap.displayed).toBe(1)
    expect(snap.discarded).toBe(1)
    expect(snap.endedAt).toBeUndefined()
  })

  it('freeze keeps the last session visible and ignores new records', () => {
    const s = new SessionMetrics()
    s.reset('01932a3b-4c5d-7000-8000-0000000000aa')
    s.recordCommentReceived()
    s.freeze()
    const last = s.snapshot()
    expect(last.commentReceived).toBe(1)
    expect(last.endedAt).toBeDefined()
    // New records after freeze must not mutate the frozen "last session".
    s.recordCommentReceived()
    s.recordSemanticType('funny_joke')
    expect(s.snapshot().commentReceived).toBe(1)
  })

  it('computes running average and P95 for latencies', () => {
    const s = new SessionMetrics()
    s.reset('01932a3b-4c5d-7000-8000-0000000000aa')
    s.recordLlmLatency(1000)
    s.recordLlmLatency(2000)
    s.recordLlmLatency(3000)
    expect(s.snapshot().llmAvgLatencyMs).toBe(2000)
    s.recordE2e(1000)
    s.recordE2e(2000)
    s.recordE2e(3000)
    s.recordE2e(4000)
    // 4 samples, P95 index = ceil(4*0.95)-1 = 3 → sorted[3] = 4000.
    expect(s.snapshot().e2eP95Ms).toBe(4000)
  })

  it('never stores content: snapshot contains counts and latencies only', () => {
    const s = new SessionMetrics()
    s.reset('01932a3b-4c5d-7000-8000-0000000000aa')
    s.recordCommentReceived()
    const json = JSON.stringify(s.snapshot())
    expect(json).not.toContain('trace')
    expect(json).not.toContain('弹幕')
    expect(json).not.toContain('nickname')
  })
})
