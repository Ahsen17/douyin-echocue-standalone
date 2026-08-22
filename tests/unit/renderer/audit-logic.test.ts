import { describe, it, expect } from 'vitest'
import type { AuditWorkflowV1 } from '@echocue/contracts'
import {
  buildTimeline,
  defaultRevisionCount,
  localizeFinalState,
  localizeLabelStatus,
  pageCount,
  shortTime,
} from '../../../src/renderer/main/audit/audit-logic.js'

describe('audit-logic', () => {
  describe('localizeFinalState', () => {
    it('maps every final state', () => {
      expect(localizeFinalState('HIDDEN')).toBe('已展示后隐藏')
      expect(localizeFinalState('FILTERED')).toBe('已过滤')
      expect(localizeFinalState('FAILED')).toBe('未生成')
      expect(localizeFinalState('DISCARDED')).toBe('展示前失效')
    })
    it('shows 进行中 for in-flight', () => expect(localizeFinalState(null)).toBe('进行中'))
  })

  describe('localizeLabelStatus', () => {
    it('maps every status', () => {
      expect(localizeLabelStatus('UNLABELED')).toBe('未打标')
      expect(localizeLabelStatus('ACCEPTED')).toBe('已认可')
      expect(localizeLabelStatus('REJECTED')).toBe('已拒绝')
      expect(localizeLabelStatus('CORRECTED')).toBe('已修正')
      expect(localizeLabelStatus('NOT_APPLICABLE')).toBe('无需打标')
    })
  })

  describe('pageCount', () => {
    it('computes ceil pages', () => {
      expect(pageCount(0, 50)).toBe(1)
      expect(pageCount(50, 50)).toBe(1)
      expect(pageCount(51, 50)).toBe(2)
    })
  })

  describe('buildTimeline', () => {
    it('projects transitions in sequence order', () => {
      const workflow: AuditWorkflowV1 = {
        traceId: '01932a3b-4c5d-7000-8000-000000000001',
        transitions: [
          {
            sequenceNo: 1,
            fromState: null,
            toState: 'RECEIVED',
            reasonCode: 'EVENT_RECEIVED',
            occurredAt: '2026-08-22T00:00:00.000Z',
            snapshots: [],
          },
          {
            sequenceNo: 2,
            fromState: 'RECEIVED',
            toState: 'NORMALIZED',
            reasonCode: 'NORMALIZATION_OK',
            occurredAt: '2026-08-22T00:00:00.100Z',
            snapshots: [{ snapshotId: 's1', role: 'NORMALIZED_COMMENT', contentType: 'NORMALIZED_COMMENT_JSON', plaintext: '{}' }],
          },
        ],
      }
      const timeline = buildTimeline(workflow)
      expect(timeline.map((t) => t.sequenceNo)).toEqual([1, 2])
      expect(timeline[1].snapshots[0].role).toBe('NORMALIZED_COMMENT')
    })
  })

  describe('defaultRevisionCount', () => {
    it('returns the exact observed revision count (M-1 fix)', () => {
      expect(defaultRevisionCount({ labelStatus: 'UNLABELED', revisionCount: 0 } as never)).toBe(0)
      expect(defaultRevisionCount({ labelStatus: 'ACCEPTED', revisionCount: 1 } as never)).toBe(1)
      expect(defaultRevisionCount({ labelStatus: 'CORRECTED', revisionCount: 2 } as never)).toBe(2)
    })
    it('handles null', () => expect(defaultRevisionCount(null)).toBe(0))
  })

  describe('shortTime', () => {
    it('formats ISO or returns empty', () => {
      expect(shortTime('2026-08-22T00:00:00.000Z')).toBeTruthy()
      expect(shortTime(null)).toBe('')
      expect(shortTime('nope')).toBe('')
    })
  })
})
