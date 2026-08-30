import { describe, expect, it } from 'vitest';
import { compileRiskFilter, detectConfiguredRisk, normalizeComment } from '../../../src/main/safety/index.js';

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

  it('normalizes keywords to the danmaku form and matches case-insensitively', () => {
    const compiled = compileRiskFilter([{ typeId: 'brand', label: '品牌', keywords: ['ID Card'] }]);
    // Whitespace is compacted exactly as the danmaku haystack is (Normalizer).
    expect(compiled[0].terms).toEqual(['idcard']);
    expect(detectConfiguredRisk(compiled, normalizeComment('show my ID Card [比心]'))).toEqual({
      typeId: 'brand',
      label: '品牌',
      term: 'idcard',
    });
    expect(detectConfiguredRisk(compiled, normalizeComment('no id card here'))).not.toBeNull();
  });

  it('matches a whole-copy keyword containing an emoji placeholder (regression)', () => {
    const compiled = compileRiskFilter([{ typeId: 'fudai', label: '福袋', keywords: ['一生一世只爱xx。[比心]'] }]);
    // The keyword is normalized to the same form as the danmaku (emoji stripped).
    expect(compiled[0].terms).toEqual(['一生一世只爱xx。']);
    expect(detectConfiguredRisk(compiled, normalizeComment('一生一世只爱xx。[比心]'))).toEqual({
      typeId: 'fudai',
      label: '福袋',
      term: '一生一世只爱xx。',
    });
  });

  it('drops keywords that normalize to empty so they never match every danmaku', () => {
    const compiled = compileRiskFilter([
      { typeId: 'e', label: '表情', keywords: ['[比心]', '   ', 'https://example.com'] },
    ]);
    expect(compiled[0].terms).toEqual([]);
    expect(detectConfiguredRisk(compiled, '任何弹幕')).toBeNull();
  });

  it('aligns fullwidth keywords to the normalized danmaku via NFKC', () => {
    const compiled = compileRiskFilter([{ typeId: 'w', label: '全角', keywords: ['ＡＢＣ'] }]);
    expect(compiled[0].terms).toEqual(['abc']);
    expect(detectConfiguredRisk(compiled, normalizeComment('hello abc 123'))).not.toBeNull();
  });
});
