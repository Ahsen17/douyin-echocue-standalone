import { describe, it, expect } from 'vitest'
import type { ConfigViewV1 } from '@echocue/contracts'
import {
  DEFAULT_DIRECT_PUSH_THRESHOLD,
  DEFAULT_SEMANTIC_DISCARD_CONFIDENCE,
  DEFAULT_PRE_SET_CALIBRATION,
  DEFAULT_GOLDEN_SET_CALIBRATION,
  buildThresholdUpdate,
  thresholdFormFromConfig,
  validateThresholdForm,
  type ThresholdForm,
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
    preSetCalibration: { center: 0, scale: 2 },
    goldenSetCalibration: { center: 0, scale: 2 },
    queueing: { enabled: false, timeoutMs: 30000 },
    audit: { retentionDays: 30 },
    metrics: { enabled: true, port: 9100 },
    riskFilter: { types: [] },
    history: { maxEntries: 20 },
    apiKeyConfigured: false,
    ...overrides,
  }
}

function validForm(overrides: Partial<ThresholdForm> = {}): ThresholdForm {
  return {
    directPush: '0.85',
    semanticDiscard: '0.9',
    preSetCenter: '0',
    preSetScale: '2',
    goldenSetCenter: '0',
    goldenSetScale: '2',
    ...overrides,
  }
}

describe('run-page retrieval threshold form (WP-4)', () => {
  it('seeds the form from the config view', () => {
    expect(thresholdFormFromConfig(configView())).toEqual({
      directPush: '0.85',
      semanticDiscard: '0.9',
      preSetCenter: '0',
      preSetScale: '2',
      goldenSetCenter: '0',
      goldenSetScale: '2',
    })
  })

  it('accepts in-range values and builds the config update', () => {
    const result = validateThresholdForm(
      validForm({ directPush: '0.7', semanticDiscard: '0.95' }),
    )
    expect(result).toEqual({
      ok: true,
      directPush: 0.7,
      semanticDiscard: 0.95,
      preSet: { center: 0, scale: 2 },
      goldenSet: { center: 0, scale: 2 },
    })
    if (result.ok) {
      expect(
        buildThresholdUpdate(result.directPush, result.semanticDiscard, result.preSet, result.goldenSet),
      ).toEqual({
        directPushThreshold: 0.7,
        semanticDiscardConfidence: 0.95,
        preSetCalibration: { center: 0, scale: 2 },
        goldenSetCalibration: { center: 0, scale: 2 },
      })
    }
  })

  it('accepts per-collection calibration params', () => {
    const result = validateThresholdForm(
      validForm({
        preSetCenter: '-1',
        preSetScale: '3',
        goldenSetCenter: '2',
        goldenSetScale: '4',
      }),
    )
    expect(result).toEqual({
      ok: true,
      directPush: 0.85,
      semanticDiscard: 0.9,
      preSet: { center: -1, scale: 3 },
      goldenSet: { center: 2, scale: 4 },
    })
  })

  it('rejects non-numeric and out-of-range values with field-specific messages', () => {
    expect(validateThresholdForm(validForm({ directPush: 'abc' }))).toEqual({
      ok: false,
      message: 'golden 直出阈值需为 0–1 之间的小数',
    })
    expect(validateThresholdForm(validForm({ directPush: '1.2' }))).toMatchObject({
      ok: false,
    })
    expect(validateThresholdForm(validForm({ semanticDiscard: '-0.1' }))).toEqual({
      ok: false,
      message: '语义丢弃阈值需为 0–1 之间的小数',
    })
    expect(validateThresholdForm(validForm({ directPush: '' }))).toMatchObject({
      ok: false,
    })
  })

  it('rejects invalid calibration params', () => {
    expect(validateThresholdForm(validForm({ preSetScale: '0' }))).toEqual({
      ok: false,
      message: 'pre_set scale 需大于 0',
    })
    expect(validateThresholdForm(validForm({ goldenSetScale: '-2' }))).toEqual({
      ok: false,
      message: 'golden_set scale 需大于 0',
    })
    expect(validateThresholdForm(validForm({ preSetCenter: 'abc' }))).toEqual({
      ok: false,
      message: '校准 center 需为有限数值',
    })
  })

  it('keeps documented defaults aligned with the runtime fallbacks', () => {
    expect(DEFAULT_DIRECT_PUSH_THRESHOLD).toBe(0.85)
    expect(DEFAULT_SEMANTIC_DISCARD_CONFIDENCE).toBe(0.9)
    expect(DEFAULT_PRE_SET_CALIBRATION).toEqual({ center: 0, scale: 2 })
    expect(DEFAULT_GOLDEN_SET_CALIBRATION).toEqual({ center: 0, scale: 2 })
  })
})
