import type { ConfigUpdateRequestV1, ConfigViewV1 } from '@echocue/contracts'

export const DEFAULT_DIRECT_PUSH_THRESHOLD = 0.85
export const DEFAULT_SEMANTIC_DISCARD_CONFIDENCE = 0.9

export interface ThresholdForm {
  directPush: string
  semanticDiscard: string
}

export type ThresholdValidation =
  | { ok: true; directPush: number; semanticDiscard: number }
  | { ok: false; message: string }

export function thresholdFormFromConfig(view: ConfigViewV1): ThresholdForm {
  return {
    directPush: String(view.directPushThreshold),
    semanticDiscard: String(view.semanticDiscardConfidence),
  }
}

// The two run-time retrieval thresholds share one 0–1 domain (CONTRACT §7.1);
// they apply on the next service start, like safety/prompt config.
export function validateThresholdForm(form: ThresholdForm): ThresholdValidation {
  // Number('') coerces to 0, so empty input maps to NaN and fails the check.
  const parse = (raw: string): number => {
    const trimmed = raw.trim()
    return trimmed === '' ? Number.NaN : Number(trimmed)
  }
  const directPush = parse(form.directPush)
  const semanticDiscard = parse(form.semanticDiscard)
  if (!Number.isFinite(directPush) || directPush < 0 || directPush > 1) {
    return { ok: false, message: 'golden 直出阈值需为 0–1 之间的小数' }
  }
  if (!Number.isFinite(semanticDiscard) || semanticDiscard < 0 || semanticDiscard > 1) {
    return { ok: false, message: '语义丢弃阈值需为 0–1 之间的小数' }
  }
  return { ok: true, directPush, semanticDiscard }
}

export function buildThresholdUpdate(directPush: number, semanticDiscard: number): ConfigUpdateRequestV1 {
  return { directPushThreshold: directPush, semanticDiscardConfidence: semanticDiscard }
}
