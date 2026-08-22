import { describe, it, expect } from 'vitest'
import type { PersonaVersionMetaV1 } from '@echocue/contracts'
import { aliasText, formatVersion, parseAliases } from '../../../src/renderer/main/persona/persona-logic.js'

describe('persona alias parsing', () => {
  it('splits by Chinese and English separators', () => {
    expect(parseAliases('阿A, 小A、阿哲；小哲\n阿哲')).toEqual([
      { aliasText: '阿A', aliasKind: 'NICKNAME' },
      { aliasText: '小A', aliasKind: 'NICKNAME' },
      { aliasText: '阿哲', aliasKind: 'NICKNAME' },
      { aliasText: '小哲', aliasKind: 'NICKNAME' },
    ])
  })

  it('dedups repeated aliases', () => {
    expect(parseAliases('阿A、阿A、阿A')).toEqual([{ aliasText: '阿A', aliasKind: 'NICKNAME' }])
  })

  it('ignores empty segments and whitespace', () => {
    expect(parseAliases('  ,  、  ，')).toEqual([])
  })

  it('serializes alias rows back to a text list', () => {
    expect(aliasText([{ aliasText: '阿A' }, { aliasText: '小A' }])).toBe('阿A、小A')
    expect(aliasText([])).toBe('')
  })
})

describe('formatVersion', () => {
  function meta(partial: Partial<PersonaVersionMetaV1>): PersonaVersionMetaV1 {
    return {
      personaVersion: 'v-1',
      personaId: 'p-1',
      status: 'DRAFT',
      contentHmac: 'hmac',
      createdAt: '2026-08-22T00:00:00.000Z',
      publishedAt: null,
      createdFromVersion: null,
      ...partial,
    }
  }

  it('labels draft with its creation time', () => {
    const value = formatVersion(meta({ status: 'DRAFT' }))
    expect(value).toContain('草稿')
    expect(value).toMatch(/草稿 · /)
  })

  it('labels published with time', () => {
    const value = formatVersion(meta({ status: 'PUBLISHED', publishedAt: '2026-08-22T12:00:00.000Z' }))
    expect(value).toContain('已发布')
    expect(value).toMatch(/已发布 · /)
  })

  it('labels superseded', () => {
    expect(formatVersion(meta({ status: 'SUPERSEDED' }))).toContain('已替代')
  })
})
