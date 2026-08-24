import { describe, it, expect } from 'vitest'
import type { ConfigViewV1 } from '@echocue/contracts'
import {
  DEFAULT_DIRECT_PUSH_THRESHOLD,
  DEFAULT_SEMANTIC_DISCARD_CONFIDENCE,
  buildThresholdUpdate,
  thresholdFormFromConfig,
  validateThresholdForm,
} from '../../../src/renderer/main/run/thresholds.js'

function configView(overrides: Partial<ConfigViewV1> = {}): ConfigViewV1 {
  return {
    overlay: {
      width: 420,
      height: 260,
      opacity: 0.95,
      fontScale: 1,
      theme: 'dark',
      durationMs: 10000,
      clickThrough: true,
    },
    directPushThreshold: 0.85,
    semanticDiscardConfidence: 0.9,
    queueing: { enabled: false, timeoutMs: 30000 },
    audit: { retentionDays: 30 },
    metrics: { enabled: true, port: 9100 },
    riskFilter: { types: [] },
    apiKeyConfigured: false,
    ...overrides,
  }
}

describe('run-page retrieval threshold form (WP-4)', () => {
  it('seeds the form from the config view', () => {
    expect(thresholdFormFromConfig(configView())).toEqual({
      directPush: '0.85',
      semanticDiscard: '0.9',
    })
  })

  it('accepts in-range values and builds the config update', () => {
    const result = validateThresholdForm({ directPush: '0.7', semanticDiscard: '0.95' })
    expect(result).toEqual({ ok: true, directPush: 0.7, semanticDiscard: 0.95 })
    if (result.ok) {
      expect(buildThresholdUpdate(result.directPush, result.semanticDiscard)).toEqual({
        directPushThreshold: 0.7,
        semanticDiscardConfidence: 0.95,
      })
    }
  })

  it('rejects non-numeric and out-of-range values with field-specific messages', () => {
    expect(validateThresholdForm({ directPush: 'abc', semanticDiscard: '0.9' })).toEqual({
      ok: false,
      message: 'golden 直出阈值需为 0–1 之间的小数',
    })
    expect(validateThresholdForm({ directPush: '1.2', semanticDiscard: '0.9' })).toMatchObject({
      ok: false,
    })
    expect(validateThresholdForm({ directPush: '0.85', semanticDiscard: '-0.1' })).toEqual({
      ok: false,
      message: '语义丢弃阈值需为 0–1 之间的小数',
    })
    expect(validateThresholdForm({ directPush: '', semanticDiscard: '0.9' })).toMatchObject({
      ok: false,
    })
  })

  it('keeps documented defaults aligned with the runtime fallbacks', () => {
    expect(DEFAULT_DIRECT_PUSH_THRESHOLD).toBe(0.85)
    expect(DEFAULT_SEMANTIC_DISCARD_CONFIDENCE).toBe(0.9)
  })
})
