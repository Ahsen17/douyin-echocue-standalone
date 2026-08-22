import type { OverlayPreferenceV1 } from '@echocue/contracts'

// Mirrors SettingsStore.getDefaults().overlay: first-run / restore-default target.
export const DEFAULT_OVERLAY_PREFS: OverlayPreferenceV1 = {
  durationMs: 10_000,
  width: 800,
  height: 200,
  opacity: 0.95,
  fontScale: 1.0,
  theme: 'dark',
  clickThrough: false,
}

// Page form state: human units (seconds / percentages) around the contract's
// ms / 0..1 fractions (UI §7).
export interface OverlayPrefForm {
  durationSec: number
  width: number
  height: number
  opacityPct: number
  fontScalePct: number
  theme: OverlayPreferenceV1['theme']
  clickThrough: boolean
}

export function prefToForm(prefs: OverlayPreferenceV1): OverlayPrefForm {
  return {
    durationSec: Math.round(prefs.durationMs / 1000),
    width: prefs.width,
    height: prefs.height,
    opacityPct: Math.round(prefs.opacity * 100),
    fontScalePct: Math.round(prefs.fontScale * 100),
    theme: prefs.theme,
    clickThrough: prefs.clickThrough,
  }
}

export function formToPref(form: OverlayPrefForm): OverlayPreferenceV1 {
  return {
    durationMs: Math.round(form.durationSec * 1000),
    width: Math.round(form.width),
    height: Math.round(form.height),
    opacity: form.opacityPct / 100,
    fontScale: form.fontScalePct / 100,
    theme: form.theme,
    clickThrough: form.clickThrough,
  }
}

// Field-level check for the most error-prone input; the contract schema stays
// the authority for the remaining bounds.
export function validateDurationSec(value: number): string | null {
  if (!Number.isInteger(value)) return '展示时长需为整数秒'
  if (value < 1 || value > 60) return '展示时长需在 1–60 秒之间'
  return null
}
