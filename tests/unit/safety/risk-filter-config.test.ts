import { describe, expect, it } from 'vitest';
import { compileRiskFilter, detectConfiguredRisk } from '../../../src/main/safety/index.js';

describe('risk-filter-config (WP-10)', () => {
  it('compiles types preserving configuration order and keyword order', () => {
    const compiled = compileRiskFilter([
      { typeId: 'a', label: 'A', keywords: ['甲', '乙'] },
      { typeId: 'b', label: 'B', keywords: ['丙'] },
    ]);
    expect(compiled).toEqual([
      { typeId: 'a', label: 'A', terms: ['甲', '乙'] },
      { typeId: 'b', label: 'B', terms: ['丙'] },
    ]);
  });

  it('returns the first type and first matching keyword', () => {
    const compiled = compileRiskFilter([
      { typeId: 'privacy', label: '隐私', keywords: ['住址', '手机号'] },
      { typeId: 'price', label: '交易', keywords: ['最低价'] },
    ]);
    expect(detectConfiguredRisk(compiled, '想问下最低价和住址')).toEqual({
      typeId: 'privacy',
      label: '隐私',
      term: '住址',
    });
    expect(detectConfiguredRisk(compiled, '只要最低价')).toEqual({
      typeId: 'price',
      label: '交易',
      term: '最低价',
    });
  });

  it('returns null when nothing matches and for empty config', () => {
    expect(detectConfiguredRisk([], '手机号是多少')).toBeNull();
    expect(detectConfiguredRisk(compileRiskFilter([]), '手机号是多少')).toBeNull();
  });

  it('lowercases keywords at compile and the text at match (case-insensitive)', () => {
    const compiled = compileRiskFilter([{ typeId: 'brand', label: '品牌', keywords: ['ID Card'] }]);
    expect(compiled[0].terms).toEqual(['id card']);
    expect(detectConfiguredRisk(compiled, 'my ID Card number is 123')).toEqual({
      typeId: 'brand',
      label: '品牌',
      term: 'id card',
    });
    expect(detectConfiguredRisk(compiled, 'no id card here')).not.toBeNull();
  });
});
