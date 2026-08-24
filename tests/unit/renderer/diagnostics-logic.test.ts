import { describe, it, expect } from 'vitest'
import {
  buildCopyableSummary,
  buildMonitoringRows,
  formatBytes,
  formatDateTime,
  formatE2eMs,
  formatSessionRange,
  localizeDomainError,
  localizeSemanticType,
  localizeSuggestionResult,
  semanticTypeEntries,
} from '../../../src/renderer/main/diagnostics/diagnostics-logic.js'

describe('diagnostics-logic', () => {
  describe('formatBytes', () => {
    it('formats GiB', () => expect(formatBytes(12 * 1024 ** 3)).toBe('12.0 GiB'))
    it('formats MiB', () => expect(formatBytes(820 * 1024 ** 2)).toBe('820 MiB'))
    it('returns 暂无 for undefined', () => expect(formatBytes(undefined)).toBe('暂无'))
    it('returns 暂无 for negative', () => expect(formatBytes(-1)).toBe('暂无'))
  })

  describe('formatDateTime', () => {
    it('formats an ISO timestamp as yyyy-MM-dd HH:mm:ss in local time', () => {
      expect(formatDateTime('2026-08-22T12:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    })
    it('pads single-digit month/day/hour/minute/second', () => {
      // Build the ISO from local date parts so the assertion is TZ-independent.
      const iso = new Date(2026, 0, 5, 3, 4, 5).toISOString()
      expect(formatDateTime(iso)).toBe('2026-01-05 03:04:05')
    })
    it('returns empty for missing or invalid input', () => {
      expect(formatDateTime(undefined)).toBe('')
      expect(formatDateTime(null)).toBe('')
      expect(formatDateTime('not-a-date')).toBe('')
    })
  })

  describe('formatE2eMs', () => {
    it('keeps exactly two decimals with trailing zeros', () => {
      expect(formatE2eMs(1800)).toBe('1800.00 ms')
      expect(formatE2eMs(1234.567)).toBe('1234.57 ms')
    })
  })

  describe('localizeSuggestionResult', () => {
    it('maps every enum value', () => {
      expect(localizeSuggestionResult('displayed')).toBe('已展示后隐藏')
      expect(localizeSuggestionResult('filtered')).toBe('已过滤')
      expect(localizeSuggestionResult('discarded')).toBe('未生成')
      expect(localizeSuggestionResult('failed')).toBe('生成失败')
    })
    it('returns 暂无 when absent', () => expect(localizeSuggestionResult(undefined)).toBe('暂无'))
  })

  describe('localizeDomainError', () => {
    it('hints for E_STORAGE_LOW', () => {
      expect(localizeDomainError('E_STORAGE_LOW')).toContain('存储空间不足')
    })
    it('returns null when no error', () => expect(localizeDomainError(undefined)).toBeNull())
  })

  describe('buildCopyableSummary', () => {
    it('contains only desensitized fields', () => {
      const text = buildCopyableSummary({
        lifecycle: 'RUNNING',
        activity: 'LISTENING',
        lastCommentReceivedAt: '2026-08-22T12:00:00.000Z',
        lastSuggestionAt: '2026-08-22T12:00:02.000Z',
        lastSuggestionResult: 'displayed',
        lastE2eLatencyMs: 1800,
        storageAvailableBytes: 12 * 1024 ** 3,
        lastDomainError: 'E_PROVIDER_TIMEOUT',
      })
      expect(text).toContain('RUNNING / LISTENING')
      expect(text).toContain('12.0 GiB')
      // Timestamps render as yyyy-MM-dd HH:mm:ss (not the raw ISO tail).
      expect(text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
      expect(text).not.toContain('T12:00:00.000Z')
      // E2E latency keeps exactly two decimals.
      expect(text).toContain('1800.00 ms')
      expect(text).not.toContain('trace_id')
      expect(text).not.toContain('sk-')
      expect(text).not.toContain('主播晚上好')
      expect(text).not.toContain('Authorization')
    })

    it('marks low space in the copyable summary', () => {
      const text = buildCopyableSummary({
        lifecycle: 'RUNNING',
        activity: 'LISTENING',
        storageAvailableBytes: 512 * 1024 ** 2,
        storageLowSpace: true,
      })
      expect(text).toContain('E_STORAGE_LOW')
    })
  })
})

describe('WP-1 monitoring formatting (补充九: 中文命名)', () => {
  it('localizes semantic types to Chinese, never the raw enum', () => {
    expect(localizeSemanticType('persona_relevant')).toBe('人设相关')
    expect(localizeSemanticType('positive_praise')).toBe('正向夸奖')
    expect(localizeSemanticType('low_value')).toBe('低价值')
    expect(localizeSemanticType('unknown_type')).toBe('unknown_type')
  })

  it('formats the session range, marking a live session as 运行中', () => {
    expect(formatSessionRange({ commentReceived: 0, commentFiltered: 0, semanticTypeCounts: {}, llmRequests: 0, displayed: 0, filtered: 0, discarded: 0, failed: 0 })).toBe('暂无直播会话')
    expect(formatSessionRange({
      sessionId: '01932a3b-4c5d-7000-8000-0000000000aa',
      startedAt: '2026-08-24T01:00:00.000Z',
      commentReceived: 0, commentFiltered: 0, semanticTypeCounts: {}, llmRequests: 0,
      displayed: 0, filtered: 0, discarded: 0, failed: 0,
    })).toContain('运行中')
    expect(formatSessionRange({
      sessionId: '01932a3b-4c5d-7000-8000-0000000000aa',
      startedAt: '2026-08-24T01:00:00.000Z',
      endedAt: '2026-08-24T02:00:00.000Z',
      commentReceived: 0, commentFiltered: 0, semanticTypeCounts: {}, llmRequests: 0,
      displayed: 0, filtered: 0, discarded: 0, failed: 0,
    })).toContain('～')
  })

  it('builds Chinese monitoring rows with business metrics front and center', () => {
    const rows = buildMonitoringRows({
      sessionId: '01932a3b-4c5d-7000-8000-0000000000aa',
      commentReceived: 120,
      commentFiltered: 5,
      semanticTypeCounts: { persona_relevant: 10 },
      llmRequests: 8,
      llmAvgLatencyMs: 1840.4,
      displayed: 6,
      filtered: 5,
      discarded: 3,
      failed: 1,
      e2eP95Ms: 2710,
    })
    expect(rows).toEqual([
      { label: '捕获弹幕数', value: '120' },
      { label: '过滤弹幕数', value: '5' },
      { label: '成功展示数', value: '6' },
      { label: '丢弃数', value: '3' },
      { label: '失败数', value: '1' },
      { label: 'LLM 调用次数', value: '8' },
      { label: 'LLM 平均时延', value: '1840 ms' },
      { label: '端到端 P95', value: '2710 ms' },
    ])
    // No raw prometheus metric name leaks into the UI labels.
    for (const row of rows) expect(row.label).not.toMatch(/echocue_/)
  })

  it('sorts semantic type entries by count desc and drops zeros', () => {
    const entries = semanticTypeEntries({
      commentReceived: 0, commentFiltered: 0,
      semanticTypeCounts: { low_value: 2, persona_relevant: 10, filter_risk: 0 },
      llmRequests: 0, displayed: 0, filtered: 0, discarded: 0, failed: 0,
    })
    expect(entries).toEqual([['persona_relevant', 10], ['low_value', 2]])
  })
})
