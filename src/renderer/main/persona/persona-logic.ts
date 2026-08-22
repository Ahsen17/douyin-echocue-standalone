import type { AliasRowV1, PersonaVersionMetaV1 } from '@echocue/contracts'

const SPLIT_RE = /[,，、;；\n]+/

export interface AliasTextInput {
  aliasText: string
  aliasKind: 'NICKNAME'
}

// Parse a comma/顿号-separated alias string into NICKNAME inputs, deduped.
export function parseAliases(text: string): AliasTextInput[] {
  const seen = new Set<string>()
  const result: AliasTextInput[] = []
  for (const part of text.split(SPLIT_RE)) {
    const aliasText = part.trim()
    if (aliasText.length === 0 || seen.has(aliasText)) continue
    seen.add(aliasText)
    result.push({ aliasText, aliasKind: 'NICKNAME' })
  }
  return result
}

export function aliasText(aliases: ReadonlyArray<Pick<AliasRowV1, 'aliasText'>>): string {
  return aliases.map((a) => a.aliasText).join('、')
}

const STATUS_LABELS: Record<PersonaVersionMetaV1['status'], string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  SUPERSEDED: '已替代',
}

function shortTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function formatVersion(meta: PersonaVersionMetaV1): string {
  const time = shortTime(meta.publishedAt ?? meta.createdAt)
  const label = STATUS_LABELS[meta.status]
  return time ? `${label} · ${time}` : label
}
