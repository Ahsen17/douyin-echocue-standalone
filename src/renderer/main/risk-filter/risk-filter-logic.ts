import type { RiskFilterTypeV1 } from '@echocue/contracts'

// Renderer-safe uuidV7 (contract typeId rule); uses window.crypto instead of
// node:crypto so this module stays inside the renderer process boundary.
export function newRiskTypeId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let ms = BigInt(Date.now())
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(ms & 0xffn)
    ms >>= 8n
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const RISK_TYPE_MAX_KEYWORDS = 50
export const RISK_TYPES_MAX_COUNT = 100
export const RISK_LABEL_MAX = 40
export const RISK_KEYWORD_MAX = 40

export interface RiskTypeDraft {
  typeId: string
  label: string
  keywords: string[]
}

export function toRiskDrafts(types: readonly RiskFilterTypeV1[]): RiskTypeDraft[] {
  return types.map((type) => ({ typeId: type.typeId, label: type.label, keywords: [...type.keywords] }))
}

export function fromRiskDrafts(drafts: readonly RiskTypeDraft[]): RiskFilterTypeV1[] {
  // The label is the type's identity; a keyword-only draft is rejected by the
  // validator, so drop it here rather than persisting an unnamed type.
  return drafts
    .map((d) => ({
      typeId: d.typeId,
      label: d.label.trim(),
      keywords: d.keywords.map((k) => k.trim()).filter((k) => k.length > 0),
    }))
    .filter((type) => type.label.length > 0)
}

export type RiskValidation = { ok: true; types: RiskFilterTypeV1[] } | { ok: false; message: string }

// Labels 1..40, keywords 1..40 each, ≤50 per type, ≤100 types. Empty types are
// dropped before save; a type with a label but no keywords is inert but allowed
// so the editor can stage edits (contract comment mirrors this).
export function validateRiskDrafts(drafts: readonly RiskTypeDraft[]): RiskValidation {
  if (drafts.length > RISK_TYPES_MAX_COUNT) {
    return { ok: false, message: `风险类型最多 ${RISK_TYPES_MAX_COUNT} 个` }
  }
  for (const draft of drafts) {
    const label = draft.label.trim()
    if (label === '') {
      return { ok: false, message: '类型名称不能为空' }
    }
    if (label.length > RISK_LABEL_MAX) {
      return { ok: false, message: `类型名称最长 ${RISK_LABEL_MAX} 字` }
    }
    if (draft.keywords.length > RISK_TYPE_MAX_KEYWORDS) {
      return { ok: false, message: '单个类型最多 50 个关键词' }
    }
    for (const keyword of draft.keywords) {
      const k = keyword.trim()
      if (k === '') {
        return { ok: false, message: '关键词不能为空' }
      }
      if (k.length > RISK_KEYWORD_MAX) {
        return { ok: false, message: `关键词最长 ${RISK_KEYWORD_MAX} 字` }
      }
    }
  }
  return { ok: true, types: fromRiskDrafts(drafts) }
}

export function validateRiskKeyword(keyword: string, existing: readonly string[]): string | null {
  const trimmed = keyword.trim()
  if (trimmed === '') return '关键词不能为空'
  if (trimmed.length > RISK_KEYWORD_MAX) return `关键词最长 ${RISK_KEYWORD_MAX} 字`
  if (existing.includes(trimmed)) return '该关键词已存在'
  return null
}
