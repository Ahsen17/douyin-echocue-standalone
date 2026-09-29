import type { ConfigUpdateRequestV1, ConfigViewV1 } from '@echocue/contracts'
import { DEFAULT_MIN_REFERENCE_CONFIDENCE_V1 } from '@echocue/contracts'

export const DEFAULT_DIRECT_PUSH_THRESHOLD = 0.85
export const DEFAULT_SEMANTIC_DISCARD_CONFIDENCE = 0.9
export const DEFAULT_MIN_REFERENCE_CONFIDENCE = DEFAULT_MIN_REFERENCE_CONFIDENCE_V1
export const DEFAULT_PRE_SET_CALIBRATION = { center: 0, scale: 2 }
export const DEFAULT_GOLDEN_SET_CALIBRATION = { center: 0, scale: 2 }

export interface CalibrationForm {
  center: number
  scale: number
}

export interface ThresholdForm {
  directPush: string
  semanticDiscard: string
  minReference: string
  preSetCenter: string
  preSetScale: string
  goldenSetCenter: string
  goldenSetScale: string
}

export type ThresholdValidation =
  | {
      ok: true
      directPush: number
      semanticDiscard: number
      minReference: number
      preSet: CalibrationForm
      goldenSet: CalibrationForm
    }
  | { ok: false; message: string }

export function thresholdFormFromConfig(view: ConfigViewV1): ThresholdForm {
  return {
    directPush: String(view.directPushThreshold),
    semanticDiscard: String(view.semanticDiscardConfidence),
    minReference: String(view.minReferenceConfidence),
    preSetCenter: String(view.preSetCalibration.center),
    preSetScale: String(view.preSetCalibration.scale),
    goldenSetCenter: String(view.goldenSetCalibration.center),
    goldenSetScale: String(view.goldenSetCalibration.scale),
  }
}

// The three run-time retrieval thresholds share one 0–1 domain (CONTRACT §7.1);
// the per-collection sigmoid calibration params are finite center / positive
// scale. All apply on the next service start, like safety/prompt config.
export function validateThresholdForm(form: ThresholdForm): ThresholdValidation {
  // Number('') coerces to 0, so empty input maps to NaN and fails the check.
  const parse = (raw: string): number => {
    const trimmed = raw.trim()
    return trimmed === '' ? Number.NaN : Number(trimmed)
  }
  const directPush = parse(form.directPush)
  const semanticDiscard = parse(form.semanticDiscard)
  const minReference = parse(form.minReference)
  if (!Number.isFinite(directPush) || directPush < 0 || directPush > 1) {
    return { ok: false, message: 'golden 直出阈值需为 0–1 之间的小数' }
  }
  if (!Number.isFinite(semanticDiscard) || semanticDiscard < 0 || semanticDiscard > 1) {
    return { ok: false, message: '语义丢弃阈值需为 0–1 之间的小数' }
  }
  if (!Number.isFinite(minReference) || minReference < 0 || minReference > 1) {
    return { ok: false, message: '参考案例置信度地板需为 0–1 之间的小数' }
  }
  const preSet = { center: parse(form.preSetCenter), scale: parse(form.preSetScale) }
  const goldenSet = { center: parse(form.goldenSetCenter), scale: parse(form.goldenSetScale) }
  if (!Number.isFinite(preSet.center) || !Number.isFinite(goldenSet.center)) {
    return { ok: false, message: '校准 center 需为有限数值' }
  }
  if (!Number.isFinite(preSet.scale) || preSet.scale <= 0) {
    return { ok: false, message: 'pre_set scale 需大于 0' }
  }
  if (!Number.isFinite(goldenSet.scale) || goldenSet.scale <= 0) {
    return { ok: false, message: 'golden_set scale 需大于 0' }
  }
  return { ok: true, directPush, semanticDiscard, minReference, preSet, goldenSet }
}

export function buildThresholdUpdate(
  directPush: number,
  semanticDiscard: number,
  minReference: number,
  preSet: CalibrationForm,
  goldenSet: CalibrationForm,
): ConfigUpdateRequestV1 {
  return {
    directPushThreshold: directPush,
    semanticDiscardConfidence: semanticDiscard,
    minReferenceConfidence: minReference,
    preSetCalibration: preSet,
    goldenSetCalibration: goldenSet,
  }
}
