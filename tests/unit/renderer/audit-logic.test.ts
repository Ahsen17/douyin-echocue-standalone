import { describe, it, expect } from 'vitest'
import type { AuditWorkflowV1 } from '@echocue/contracts'
import {
  buildTimeline,
  defaultRevisionCount,
  extractSuggestionFromWorkflow,
  localizeFinalState,
  localizeLabelStatus,
  pageCount,
  resolveSelectedRow,
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

  describe('extractSuggestionFromWorkflow', () => {
    const base = (snapshots: AuditWorkflowV1['transitions'][number]['snapshots']): AuditWorkflowV1 => ({
      traceId: '01932a3b-4c5d-7000-8000-000000000001',
      transitions: [
        {
          sequenceNo: 1,
          fromState: null,
          toState: 'DISPLAY_READY',
          reasonCode: 'OVERLAY_RENDERED',
          occurredAt: '2026-08-22T00:00:00.000Z',
          snapshots,
        },
      ],
    })

    it('reads the direct payload (snake_case quick_reply)', () => {
      const wf = base([{
        snapshotId: 's1',
        role: 'DIRECT_PAYLOAD',
        contentType: 'SUGGESTION_JSON',
        plaintext: JSON.stringify({ quick_reply: '谢谢夸奖', cues: ['接住夸奖', '继续互动'] }),
      }])
      expect(extractSuggestionFromWorkflow(wf)).toEqual({
        quickReply: '谢谢夸奖',
        cues: ['接住夸奖', '继续互动'],
      })
    })

    it('reads the LLM parsed output (camelCase quickReply)', () => {
      const wf = base([{
        snapshotId: 's2',
        role: 'LLM_PARSED_OUTPUT',
        contentType: 'SUGGESTION_JSON',
        plaintext: JSON.stringify({ quickReply: '欢迎来玩', cues: ['问候', '引导关注'] }),
      }])
      expect(extractSuggestionFromWorkflow(wf)).toEqual({
        quickReply: '欢迎来玩',
        cues: ['问候', '引导关注'],
      })
    })

    it('keeps the reply when cues are missing or empty (M4 fix)', () => {
      const noCues = base([{
        snapshotId: 's4',
        role: 'DIRECT_PAYLOAD',
        contentType: 'SUGGESTION_JSON',
        plaintext: JSON.stringify({ quick_reply: '谢谢支持' }),
      }])
      expect(extractSuggestionFromWorkflow(noCues)).toEqual({ quickReply: '谢谢支持', cues: [] })
      const emptyCues = base([{
        snapshotId: 's5',
        role: 'DIRECT_PAYLOAD',
        contentType: 'SUGGESTION_JSON',
        plaintext: JSON.stringify({ quick_reply: '谢谢支持', cues: [] }),
      }])
      expect(extractSuggestionFromWorkflow(emptyCues)).toEqual({ quickReply: '谢谢支持', cues: [] })
    })

    it('drops empty-string cues instead of the whole reply (n-3)', () => {
      const wf = base([{
        snapshotId: 's6',
        role: 'DIRECT_PAYLOAD',
        contentType: 'SUGGESTION_JSON',
        plaintext: JSON.stringify({ quick_reply: '谢谢支持', cues: ['接住', ''] }),
      }])
      expect(extractSuggestionFromWorkflow(wf)).toEqual({ quickReply: '谢谢支持', cues: ['接住'] })
    })

    it('returns null when the workflow has no suggestion snapshot', () => {
      expect(extractSuggestionFromWorkflow(base([]))).toBeNull()
      expect(extractSuggestionFromWorkflow(null)).toBeNull()
    })

    it('returns null on malformed or empty suggestion JSON', () => {
      const wf = base([{
        snapshotId: 's3',
        role: 'LLM_PARSED_OUTPUT',
        contentType: 'SUGGESTION_JSON',
        plaintext: 'not json',
      }])
      expect(extractSuggestionFromWorkflow(wf)).toBeNull()
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

  describe('resolveSelectedRow', () => {
    const rows = [
      { traceId: 'a' },
      { traceId: 'b' },
    ] as never as readonly import('@echocue/contracts').AuditTraceSummaryV1[]

    it('returns the row matching the selected id', () => {
      expect(resolveSelectedRow(rows, 'b')?.traceId).toBe('b')
    })
    it('defaults to the first row when nothing is selected', () => {
      expect(resolveSelectedRow(rows, null)?.traceId).toBe('a')
    })
    it('returns null when the selected id left the page (never jumps to another row)', () => {
      expect(resolveSelectedRow(rows, 'gone')).toBeNull()
    })
    it('returns null on an empty page', () => {
      expect(resolveSelectedRow([], 'a')).toBeNull()
      expect(resolveSelectedRow([], null)).toBeNull()
    })
  })
})
