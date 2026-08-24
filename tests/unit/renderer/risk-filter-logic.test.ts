import { describe, expect, it } from 'vitest'
import {
  fromRiskDrafts,
  newRiskTypeId,
  toRiskDrafts,
  validateRiskDrafts,
  validateRiskKeyword,
} from '../../../src/renderer/main/risk-filter/risk-filter-logic.js'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('risk-filter logic (WP-10)', () => {
  it('newRiskTypeId returns a uuidV7', () => {
    expect(newRiskTypeId()).toMatch(UUID_V7)
    expect(newRiskTypeId()).not.toBe(newRiskTypeId())
  })

  it('round-trips config types through drafts', () => {
    const types = [{ typeId: 't1', label: '隐私', keywords: ['住址', '手机号'] }]
    expect(toRiskDrafts(types)).toEqual([{ typeId: 't1', label: '隐私', keywords: ['住址', '手机号'] }])
    expect(fromRiskDrafts(toRiskDrafts(types))).toEqual(types)
  })

  it('drops empty keywords and empty types on save', () => {
    const drafts = [
      { typeId: 't1', label: '隐私', keywords: [' 住址 ', '', '   '] },
      { typeId: 't2', label: '   ', keywords: ['x'] },
    ]
    expect(fromRiskDrafts(drafts)).toEqual([{ typeId: 't1', label: '隐私', keywords: ['住址'] }])
  })

  it('rejects empty labels, oversize labels, and oversize keywords', () => {
    expect(validateRiskDrafts([{ typeId: 't1', label: '', keywords: [] }])).toMatchObject({ ok: false })
    expect(validateRiskDrafts([{ typeId: 't1', label: 'x'.repeat(41), keywords: [] }])).toMatchObject({ ok: false })
    expect(validateRiskDrafts([{ typeId: 't1', label: '隐私', keywords: ['y'.repeat(41)] }])).toMatchObject({ ok: false })
  })

  it('validates keyword additions against duplicates and length', () => {
    expect(validateRiskKeyword('   ', [])).toBe('关键词不能为空')
    expect(validateRiskKeyword('x'.repeat(41), [])).toBe('关键词最长 40 字')
    expect(validateRiskKeyword('住址', ['住址'])).toBe('该关键词已存在')
    expect(validateRiskKeyword('手机号', ['住址'])).toBeNull()
  })

  it('validates a clean draft list and returns trimmed types', () => {
    const result = validateRiskDrafts([{ typeId: 't1', label: ' 隐私 ', keywords: [' 手机号 '] }])
    expect(result).toEqual({ ok: true, types: [{ typeId: 't1', label: '隐私', keywords: ['手机号'] }] })
  })
})
