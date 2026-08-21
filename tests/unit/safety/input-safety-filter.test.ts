import { describe, it, expect } from 'vitest';
import {
  BUILTIN_CATEGORY_TERMS,
  BUILTIN_ORDER,
  evaluateInputSafety,
  type CompiledSafetyRuleV1,
} from '../../../src/main/safety/index.js';

function rules(...rs: CompiledSafetyRuleV1[]): CompiledSafetyRuleV1[] {
  return rs;
}

describe('evaluateInputSafety', () => {
  it('filters built-in PII', () => {
    const d = evaluateInputSafety({ normalizedText: '你家具体住址和手机号是多少', compiledRules: [] });
    expect(d).toEqual({ allow: false, reason: 'PII', matchedRule: null });
  });

  it('filters built-in ABUSE', () => {
    const d = evaluateInputSafety({ normalizedText: '带有侮辱谩骂的测试占位文本', compiledRules: [] });
    expect(d).toEqual({ allow: false, reason: 'ABUSE', matchedRule: null });
  });

  it('allows safe content', () => {
    const d = evaluateInputSafety({ normalizedText: '今天状态真好，给大家分享一下吧', compiledRules: [] });
    expect(d).toEqual({ allow: true, reason: null, matchedRule: null });
  });

  it('detects every built-in category from its term list', () => {
    for (const category of BUILTIN_ORDER) {
      const term = BUILTIN_CATEGORY_TERMS[category][0];
      const d = evaluateInputSafety({ normalizedText: `前缀${term}后缀`, compiledRules: [] });
      expect(d.allow).toBe(false);
      if (!d.allow) {
        expect(d.reason).toBe(category);
      }
    }
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

  it('gives built-in detectors precedence over compiled rules', () => {
    const d = evaluateInputSafety({
      normalizedText: '你家住址和最低价分别是',
      compiledRules: rules({ ruleType: 'KEYWORD', category: 'TRANSACTION_PRICE', text: '最低价' }),
    });
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe('PII');
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
