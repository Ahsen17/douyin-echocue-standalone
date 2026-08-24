import { describe, it, expect } from 'vitest';
import {
  evaluateInputSafety,
  type CompiledRiskType,
  type CompiledSafetyRuleV1,
} from '../../../src/main/safety/index.js';

function rules(...rs: CompiledSafetyRuleV1[]): CompiledSafetyRuleV1[] {
  return rs;
}

function risk(...types: CompiledRiskType[]): readonly CompiledRiskType[] {
  return types;
}

describe('evaluateInputSafety', () => {
  it('filters a configured PII-type risk keyword', () => {
    const d = evaluateInputSafety({
      normalizedText: '你家具体住址和手机号是多少',
      compiledRules: [],
      riskFilter: risk({ typeId: 'privacy', label: '隐私', terms: ['住址', '手机号'] }),
    });
    expect(d).toEqual({ allow: false, reason: 'privacy', matchedRule: null });
  });

  it('filters the first matching configured type by keyword order', () => {
    const d = evaluateInputSafety({
      normalizedText: '带有侮辱谩骂的测试占位文本',
      compiledRules: [],
      riskFilter: risk({ typeId: 'abuse-cfg', label: '辱骂', terms: ['侮辱', '谩骂'] }),
    });
    expect(d).toEqual({ allow: false, reason: 'abuse-cfg', matchedRule: null });
  });

  it('allows safe content', () => {
    const d = evaluateInputSafety({ normalizedText: '今天状态真好，给大家分享一下吧', compiledRules: [] });
    expect(d).toEqual({ allow: true, reason: null, matchedRule: null });
  });

  it('matches the first type and first keyword in configuration order', () => {
    const filter = risk(
      { typeId: 'a', label: 'A', terms: ['甲'] },
      { typeId: 'b', label: 'B', terms: ['乙', '甲'] },
    );
    // '甲' hits both types; configuration order picks type a.
    expect(evaluateInputSafety({ normalizedText: '前缀甲后缀', compiledRules: [], riskFilter: filter })).toEqual({
      allow: false,
      reason: 'a',
      matchedRule: null,
    });
    // '乙' only exists in type b.
    expect(evaluateInputSafety({ normalizedText: '前缀乙后缀', compiledRules: [], riskFilter: filter })).toEqual({
      allow: false,
      reason: 'b',
      matchedRule: null,
    });
  });

  it('skips the risk step entirely when riskFilter is empty or absent', () => {
    // WP-10: unconfigured risk filter means no risk filtering at all.
    expect(evaluateInputSafety({ normalizedText: '手机号是多少', compiledRules: [] }).allow).toBe(true);
    expect(evaluateInputSafety({ normalizedText: '手机号是多少', compiledRules: [], riskFilter: [] }).allow).toBe(true);
  });

  it('hits a compiled KEYWORD rule', () => {
    const d = evaluateInputSafety({
      normalizedText: '这是公司机密内容',
      compiledRules: rules({ ruleType: 'KEYWORD', category: 'TEAM_FORBIDDEN', text: '机密' }),
    });
    expect(d).toEqual({
      allow: false,
      reason: 'TEAM_FORBIDDEN',
      matchedRule: { ruleType: 'KEYWORD', category: 'TEAM_FORBIDDEN', text: '机密' },
    });
  });

  it('hits a compiled REGEX rule', () => {
    const d = evaluateInputSafety({
      normalizedText: '订单号12345确认',
      compiledRules: rules({ ruleType: 'REGEX', category: 'TEAM_FORBIDDEN', text: '\\d{4,}' }),
    });
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe('TEAM_FORBIDDEN');
      expect(d.matchedRule?.ruleType).toBe('REGEX');
    }
  });

  it('hits a compiled TOPIC_PHRASE rule', () => {
    const d = evaluateInputSafety({
      normalizedText: '不要聊公司机密哈',
      compiledRules: rules({ ruleType: 'TOPIC_PHRASE', category: 'TEAM_FORBIDDEN', text: '公司机密' }),
    });
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe('TEAM_FORBIDDEN');
      expect(d.matchedRule?.ruleType).toBe('TOPIC_PHRASE');
    }
  });

  it('skips non-matching compiled rules', () => {
    const d = evaluateInputSafety({
      normalizedText: '今天天气不错',
      compiledRules: rules({ ruleType: 'KEYWORD', category: 'TEAM_FORBIDDEN', text: '机密' }),
    });
    expect(d.allow).toBe(true);
  });

  it('gives the configured risk filter precedence over compiled rules', () => {
    const d = evaluateInputSafety({
      normalizedText: '你家住址和最低价分别是',
      compiledRules: rules({ ruleType: 'KEYWORD', category: 'TRANSACTION_PRICE', text: '最低价' }),
      riskFilter: risk({ typeId: 'privacy', label: '隐私', terms: ['住址'] }),
    });
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe('privacy');
      expect(d.matchedRule).toBeNull();
    }
  });

  it('fails closed to SAFETY_ENGINE_ERROR when the policy is missing', () => {
    const d = evaluateInputSafety({ normalizedText: '任何内容', compiledRules: null });
    expect(d).toEqual({ allow: false, reason: 'SAFETY_ENGINE_ERROR', matchedRule: null });
  });

  it('fails closed on an unknown rule type', () => {
    const d = evaluateInputSafety({
      normalizedText: '任何内容',
      compiledRules: [{ ruleType: 'UNKNOWN', category: 'TEAM_FORBIDDEN', text: 'x' } as unknown as CompiledSafetyRuleV1],
    });
    expect(d).toEqual({ allow: false, reason: 'SAFETY_ENGINE_ERROR', matchedRule: null });
  });

  it('fails closed when a compiled REGEX pattern is invalid at runtime', () => {
    const d = evaluateInputSafety({
      normalizedText: '任何内容',
      compiledRules: rules({ ruleType: 'REGEX', category: 'TEAM_FORBIDDEN', text: '(' }),
    });
    expect(d).toEqual({ allow: false, reason: 'SAFETY_ENGINE_ERROR', matchedRule: null });
  });

  it('allows empty and whitespace-only normalized text', () => {
    expect(evaluateInputSafety({ normalizedText: '', compiledRules: [] }).allow).toBe(true);
    expect(evaluateInputSafety({ normalizedText: '   ', compiledRules: [] }).allow).toBe(true);
  });

  it('evaluates KEYWORD before TOPIC_PHRASE regardless of compiler output order', () => {
    const d = evaluateInputSafety({
      normalizedText: '电话和直播失误',
      compiledRules: rules(
        { ruleType: 'TOPIC_PHRASE', category: 'TEAM_FORBIDDEN', text: '直播失误' },
        { ruleType: 'KEYWORD', category: 'PII', text: '电话' },
      ),
    });
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe('PII');
      expect(d.matchedRule?.ruleType).toBe('KEYWORD');
    }
  });

  it('evaluates REGEX before TOPIC_PHRASE', () => {
    const d = evaluateInputSafety({
      normalizedText: '编号abc123和直播失误',
      compiledRules: rules(
        { ruleType: 'TOPIC_PHRASE', category: 'TEAM_FORBIDDEN', text: '直播失误' },
        { ruleType: 'REGEX', category: 'TEAM_FORBIDDEN', text: '\\d{3,}' },
      ),
    });
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.matchedRule?.ruleType).toBe('REGEX');
    }
  });
});
