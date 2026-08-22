import { describe, it, expect } from 'vitest'
import type { CompileErrorV1, SafetyPolicyVersionMetaV1 } from '@echocue/contracts'
import {
  formatSafetyVersion,
  localizeErrors,
  splitClauses,
  validateKeyword,
} from '../../../src/renderer/main/safety/safety-logic.js'

describe('splitClauses matches the main-process compiler', () => {
  it('splits on all six clause separators', () => {
    expect(splitClauses('不要A。不要B；不要C！不要D？不要E；不要F！')).toEqual([
      '不要A',
      '不要B',
      '不要C',
      '不要D',
      '不要E',
      '不要F',
    ])
  })

  it('drops empty and whitespace-only segments', () => {
    expect(splitClauses('不要A。。；；不要B')).toEqual(['不要A', '不要B'])
  })

  it('trims each clause', () => {
    expect(splitClauses(' 不要A ， 不要B ')).toEqual(['不要A ， 不要B'])
  })

  it('returns empty array for empty text', () => {
    expect(splitClauses('')).toEqual([])
  })

  it('matches the compiler clause count for error indexing', () => {
    // The compiler counts only non-empty clauses; consecutive separators do not
    // advance the index. A clause error must therefore land on the right index.
    const text = '不要讨论住址。；。不合适的话题都不要说。'
    expect(splitClauses(text)).toEqual(['不要讨论住址', '不合适的话题都不要说'])
  })
})

describe('localizeErrors', () => {
  it('attaches the clause for a clause-level error', () => {
    const text = '不要讨论住址；不合适的话题都不要说。'
    const errors: CompileErrorV1[] = [{ clauseIndex: 1, message: '该话题无法确定性解释，请改成明确话题或关键词' }]
    expect(localizeErrors(errors, text)).toEqual([
      { message: '该话题无法确定性解释，请改成明确话题或关键词', clause: '不合适的话题都不要说' },
    ])
  })

  it('leaves keyword-level errors without a clause', () => {
    const errors: CompileErrorV1[] = [{ clauseIndex: -1, message: '第 1 个正则关键词不是合法正则' }]
    expect(localizeErrors(errors, '不要讨论住址')).toEqual([
      { message: '第 1 个正则关键词不是合法正则', clause: null },
    ])
  })

  it('leaves out-of-range clause indexes unattached', () => {
    const errors: CompileErrorV1[] = [{ clauseIndex: 5, message: 'x' }]
    expect(localizeErrors(errors, '不要讨论住址')).toEqual([{ message: 'x', clause: null }])
  })

  it('handles empty policy text', () => {
    const errors: CompileErrorV1[] = [{ clauseIndex: 0, message: 'x' }]
    expect(localizeErrors(errors, '')).toEqual([{ message: 'x', clause: null }])
  })
})

describe('validateKeyword', () => {
  it('accepts a fresh keyword', () => {
    expect(validateKeyword('直播间', ['报价'])).toBeNull()
  })

  it('trims input before validating', () => {
    expect(validateKeyword('  直播间  ', ['报价'])).toBeNull()
  })

  it('rejects empty input', () => {
    expect(validateKeyword('   ', [])).toBe('关键词不能为空')
  })

  it('rejects duplicates', () => {
    expect(validateKeyword('直播间', ['直播间'])).toBe('该关键词已存在')
  })

  it('rejects keywords over 64 chars', () => {
    expect(validateKeyword('x'.repeat(65), [])).toBe('关键词最多 64 个字符')
  })

  it('accepts a 64-char keyword', () => {
    expect(validateKeyword('x'.repeat(64), [])).toBeNull()
  })
})

describe('formatSafetyVersion', () => {
  const base: SafetyPolicyVersionMetaV1 = {
    safetyPolicyVersion: 'sp-1',
    status: 'DRAFT',
    compilerVersion: 'SafetyRuleCompilerV1',
    createdAt: '2026-08-22T00:00:00.000Z',
    publishedAt: null,
  }

  it('labels a draft by creation time', () => {
    expect(formatSafetyVersion(base)).toContain('草稿')
  })

  it('labels a published version by publish time', () => {
    expect(
      formatSafetyVersion({ ...base, status: 'PUBLISHED', publishedAt: '2026-08-22T01:00:00.000Z' }),
    ).toContain('已发布')
  })

  it('handles a null timestamp gracefully', () => {
    expect(formatSafetyVersion({ ...base, createdAt: 'not-a-date' })).toBe('草稿')
  })
})
