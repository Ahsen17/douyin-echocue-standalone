import { describe, it, expect } from 'vitest'
import type { OverlayPreferenceV1 } from '@echocue/contracts'
import {
  DEFAULT_OVERLAY_PREFS,
  formToPref,
  prefToForm,
  validateDurationSec,
} from '../../../src/renderer/main/overlay/overlay-prefs.js'

const PREFS: OverlayPreferenceV1 = {
  durationMs: 20_000,
  width: 900,
  height: 240,
  opacity: 0.8,
  fontScale: 1.15,
  theme: 'light',
  clickThrough: true,
}

describe('prefToForm / formToPref', () => {
  it('converts contract units into human form units', () => {
    expect(prefToForm(PREFS)).toEqual({
      durationSec: 20,
      width: 900,
      height: 240,
      opacityPct: 80,
      fontScalePct: 115,
      theme: 'light',
      clickThrough: true,
    })
  })

  it('round-trips a form back into the contract shape', () => {
    const form = prefToForm(PREFS)
    expect(formToPref(form)).toEqual(PREFS)
  })

  it('converts a 10-second default exactly', () => {
    expect(prefToForm(DEFAULT_OVERLAY_PREFS).durationSec).toBe(10)
    expect(prefToForm(DEFAULT_OVERLAY_PREFS).opacityPct).toBe(95)
    expect(prefToForm(DEFAULT_OVERLAY_PREFS).fontScalePct).toBe(100)
  })

  it('keeps fractional edges intact (0.2 opacity / 0.75 fontScale)', () => {
    const form = prefToForm({ ...DEFAULT_OVERLAY_PREFS, opacity: 0.2, fontScale: 0.75 })
    expect(form.opacityPct).toBe(20)
    expect(form.fontScalePct).toBe(75)
    expect(formToPref(form).opacity).toBe(0.2)
  })
})

describe('DEFAULT_OVERLAY_PREFS', () => {
  it('mirrors the SettingsStore defaults', () => {
    expect(DEFAULT_OVERLAY_PREFS).toEqual({
      durationMs: 10_000,
      width: 800,
      height: 200,
      opacity: 0.95,
      fontScale: 1.0,
      theme: 'dark',
      clickThrough: false,
    })
  })
})

describe('validateDurationSec', () => {
  it('accepts integer seconds in 1–60', () => {
    expect(validateDurationSec(1)).toBeNull()
    expect(validateDurationSec(60)).toBeNull()
    expect(validateDurationSec(10)).toBeNull()
  })

  it('rejects non-integer seconds', () => {
    expect(validateDurationSec(2.5)).toBe('展示时长需为整数秒')
  })

  it('rejects out-of-range seconds', () => {
    expect(validateDurationSec(0)).toBe('展示时长需在 1–60 秒之间')
    expect(validateDurationSec(61)).toBe('展示时长需在 1–60 秒之间')
    expect(validateDurationSec(-1)).toBe('展示时长需在 1–60 秒之间')
  })

  it('rejects non-numeric input', () => {
    expect(validateDurationSec(Number.NaN)).toBe('展示时长需为整数秒')
  })
})
