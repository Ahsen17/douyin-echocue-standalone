import { describe, it, expect } from 'vitest';
import { loadJsonFixture, FIXTURES } from '../fixtures/index.js';
import {
  compilePolicy,
  SAFETY_COMPILER_VERSION,
  normalizeComment,
  evaluateInputSafety,
  type CompiledSafetyRuleV1,
} from '../../src/main/safety/index.js';

interface CompileCaseFixture {
  id: string;
  policyText: string;
  keywords: string[];
  expected: { valid: boolean; categories?: string[]; domainError?: string };
}

interface RuntimeRuleFixture {
  ruleType: string;
  category: string;
  text: string;
}

interface RuntimeCaseFixture {
  id: string;
  stage: 'INPUT' | 'OUTPUT';
  text?: string;
  compiledRules?: RuntimeRuleFixture[];
  simulateEngineFailure?: boolean;
  expected: { allow: boolean; reason?: string; traceFinalState: string };
}

interface SafetyPolicyFixture {
  compilerVersion: string;
  compileCases: CompileCaseFixture[];
  runtimeCases: RuntimeCaseFixture[];
}

describe('T-SAFE-001: Safety Policy Fixtures', () => {
  const fixture = loadJsonFixture<SafetyPolicyFixture>(FIXTURES.SAFETY_POLICY);

  it('should load safety policy fixture', () => {
    expect(fixture).toBeDefined();
    expect(fixture.compilerVersion).toBe(SAFETY_COMPILER_VERSION);
  });

  it('should compile valid natural language rules', () => {
    const c = fixture.compileCases.find((x) => x.id === 'explicit-topics-valid');
    expect(c).toBeDefined();
    if (!c) return;

    const result = compilePolicy({
      compilerVersion: fixture.compilerVersion,
      policyText: c.policyText,
      keywords: c.keywords,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      const categories = new Set(result.compiledRules.map((r) => r.category));
      for (const category of c.expected.categories ?? []) {
        expect(categories.has(category as never)).toBe(true);
      }
    }
  });

  it('should reject invalid regex patterns', () => {
    const c = fixture.compileCases.find((x) => x.id === 'invalid-regex');
    expect(c).toBeDefined();
    if (!c) return;

    const result = compilePolicy({
      compilerVersion: fixture.compilerVersion,
      policyText: c.policyText,
      keywords: c.keywords,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errorCode).toBe(c.expected.domainError ?? 'E_SAFETY_POLICY_INVALID');
    }
  });

  it('should run every INPUT runtime case to the fixture decision', () => {
    const inputCases = fixture.runtimeCases.filter((r) => r.stage === 'INPUT');
    expect(inputCases.length).toBeGreaterThan(0);

    for (const c of inputCases) {
      const compiledRules: CompiledSafetyRuleV1[] | null = c.simulateEngineFailure
        ? null
        : ((c.compiledRules ?? []) as CompiledSafetyRuleV1[]);
      const decision = evaluateInputSafety({
        normalizedText: c.text === undefined ? '' : normalizeComment(c.text),
        compiledRules,
      });
      expect(decision.allow).toBe(c.expected.allow);
      if (c.expected.allow) {
        expect(decision.reason).toBeNull();
      } else {
        expect(decision.reason).toBe(c.expected.reason as never);
      }
    }
  });
});
