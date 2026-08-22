import type { CompileErrorV1, SafetyPolicyVersionMetaV1 } from '@echocue/contracts'

export const KEYWORD_MAX_LENGTH = 64

// Must stay byte-identical to the main-process compiler: clauseIndex only
// counts non-empty clauses.
export function splitClauses(policyText: string): string[] {
  return policyText
    .split(/[；;。！？!?]/)
    .map((c) => c.trim())
    .filter((c) => c !== '')
}

export interface LocalizedCompileError {
  message: string
  clause: string | null
}

export function localizeErrors(errors: CompileErrorV1[], policyText: string): LocalizedCompileError[] {
  const clauses = splitClauses(policyText)
  return errors.map((error) => ({
    message: error.message,
    clause: error.clauseIndex >= 0 && error.clauseIndex < clauses.length ? clauses[error.clauseIndex] : null,
  }))
}

export function validateKeyword(input: string, existing: string[]): string | null {
  const text = input.trim()
  if (text === '') return '关键词不能为空'
  if (text.length > KEYWORD_MAX_LENGTH) return `关键词最多 ${KEYWORD_MAX_LENGTH} 个字符`
  if (existing.some((k) => k === text)) return '该关键词已存在'
  return null
}

const STATUS_LABELS: Record<SafetyPolicyVersionMetaV1['status'], string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  SUPERSEDED: '已替代',
  INVALID: '校验未通过',
}

function shortTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function formatSafetyVersion(meta: SafetyPolicyVersionMetaV1): string {
  const time = shortTime(meta.publishedAt ?? meta.createdAt)
  const label = STATUS_LABELS[meta.status]
  return time ? `${label} · ${time}` : label
}
