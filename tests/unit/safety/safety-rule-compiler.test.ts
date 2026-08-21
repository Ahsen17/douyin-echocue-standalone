import { describe, it, expect } from 'vitest';
import { loadJsonFixture, FIXTURES } from '../../fixtures/index.js';
import { compilePolicy, SAFETY_COMPILER_VERSION } from '../../../src/main/safety/index.js';
import type { CompileResult } from '../../../src/main/safety/index.js';

interface CompileCaseFixture {
  id: string;
  policyText: string;
  keywords: string[];
  expected: { valid: boolean; categories?: string[]; domainError?: string };
}

interface SafetyPolicyFixture {
  compileCases: CompileCaseFixture[];
}

function fixtureCase(id: string): CompileCaseFixture {
  const fixture = loadJsonFixture<SafetyPolicyFixture>(FIXTURES.SAFETY_POLICY);
  const c = fixture.compileCases.find((x) => x.id === id);
  if (!c) {
    throw new Error(`fixture case not found: ${id}`);
  }
  return c;
}

function assertInvalid(result: CompileResult, errorCode = 'E_SAFETY_POLICY_INVALID'): void {
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.errorCode).toBe(errorCode);
    expect(result.errors.length).toBeGreaterThan(0);
  }
}

describe('SafetyRuleCompiler (T-SAFE-001)', () => {
  it('compiles explicit topics into PII and TRANSACTION_PRICE rules', () => {
    const c = fixtureCase('explicit-topics-valid');
    const result = compilePolicy({
      compilerVersion: SAFETY_COMPILER_VERSION,
      policyText: c.policyText,
      keywords: c.keywords,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      const categories = new Set(result.compiledRules.map((r) => r.category));
      expect(categories.has('PII')).toBe(true);
      expect(categories.has('TRANSACTION_PRICE')).toBe(true);
      // Clause 1 "不要讨论主播住址和真实手机号" splits into two TOPIC_PHRASE rules.
      expect(result.compiledRules.filter((r) => r.ruleType === 'TOPIC_PHRASE')).toHaveLength(3);
      // Compound topics 主播住址 / 真实手机号 each yield one PII rule.
      expect(result.compiledRules.filter((r) => r.category === 'PII' && r.ruleType === 'TOPIC_PHRASE')).toHaveLength(2);
      // 最低价 keyword is a TRANSACTION_PRICE KEYWORD rule.
      expect(result.compiledRules.some((r) => r.ruleType === 'KEYWORD' && r.category === 'TRANSACTION_PRICE')).toBe(true);
    }
  });

  it('rejects ambiguous natural language', () => {
    const c = fixtureCase('ambiguous-natural-language-invalid');
    assertInvalid(compilePolicy({ policyText: c.policyText, keywords: c.keywords }));
  });

  it('rejects invalid regex keywords', () => {
    const c = fixtureCase('invalid-regex');
    const result = compilePolicy({ policyText: c.policyText, keywords: c.keywords });
    assertInvalid(result);
    if (!result.valid) {
      // Keyword errors carry no clause position.
      expect(result.errors.some((e) => e.clauseIndex === -1)).toBe(true);
    }
  });

  it('splits a multi-clause policy on Chinese/English sentence delimiters', () => {
    const result = compilePolicy({
      policyText: '不要讨论主播住址；禁止回应具体价格。请勿提及公司内部信息！',
      keywords: [],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.compiledRules.filter((r) => r.ruleType === 'TOPIC_PHRASE')).toHaveLength(3);
    }
  });

  it('compiles a valid regex keyword into a REGEX rule', () => {
    const result = compilePolicy({
      policyText: '',
      keywords: ['regex:\\d{4}'],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.compiledRules).toEqual([{ ruleType: 'REGEX', category: 'TEAM_FORBIDDEN', text: '\\d{4}' }]);
    }
  });

  it('defaults unknown topics to TEAM_FORBIDDEN', () => {
    const result = compilePolicy({
      policyText: '不要讨论公司机密',
      keywords: ['神秘内容'],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.compiledRules.every((r) => r.category === 'TEAM_FORBIDDEN')).toBe(true);
    }
  });

  it('treats an empty policy as valid with zero rules', () => {
    const result = compilePolicy({ policyText: '   ', keywords: [] });
    expect(result).toEqual({ valid: true, compiledRules: [] });
  });

  it('rejects a topic containing a vague word', () => {
    assertInvalid(compilePolicy({ policyText: '不要讨论敏感话题', keywords: [] }));
  });

  it('rejects a clause with negation but no concrete topic', () => {
    assertInvalid(compilePolicy({ policyText: '不要讨论', keywords: [] }));
  });

  it('rejects a topic that is only separators', () => {
    const result = compilePolicy({ policyText: '不要讨论和', keywords: [] });
    assertInvalid(result);
    if (!result.valid) {
      expect(result.errors).toContainEqual({ clauseIndex: 0, message: 'clause has no concrete topic' });
    }
  });

  it('rejects a clause without leading negation', () => {
    assertInvalid(compilePolicy({ policyText: '讨论主播住址', keywords: [] }));
  });

  it('rejects an empty regex pattern', () => {
    assertInvalid(compilePolicy({ policyText: '', keywords: ['regex:'] }));
  });

  it('skips whitespace-only keywords', () => {
    const result = compilePolicy({ policyText: '', keywords: ['  ', '最低价'] });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.compiledRules).toEqual([{ ruleType: 'KEYWORD', category: 'TRANSACTION_PRICE', text: '最低价' }]);
    }
  });

  it('rejects an unsupported compiler version', () => {
    assertInvalid(compilePolicy({ compilerVersion: 'SafetyRuleCompilerV9', policyText: '', keywords: [] }));
  });

  it('records the clause position of each error', () => {
    const result = compilePolicy({ policyText: '不要讨论主播住址；讨论价格', keywords: [] });
    assertInvalid(result);
    if (!result.valid) {
      expect(result.errors).toContainEqual({ clauseIndex: 1, message: 'clause has no leading negation' });
    }
  });
});
