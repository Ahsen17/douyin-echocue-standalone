import { describe, it, expect } from 'vitest';
import { loadJsonFixture, FIXTURES } from '../fixtures/index.js';
import { compilePolicy, SAFETY_COMPILER_VERSION } from '../../src/main/safety/index.js';

interface CompileCaseFixture {
  id: string;
  policyText: string;
  keywords: string[];
  expected: { valid: boolean; categories?: string[]; domainError?: string };
}

interface SafetyPolicyFixture {
  compilerVersion: string;
  compileCases: CompileCaseFixture[];
}

describe('T-SAFE-001: Safety Policy Fixtures', () => {
  it('should load safety policy fixture', () => {
    const fixture = loadJsonFixture<SafetyPolicyFixture>(FIXTURES.SAFETY_POLICY);
    expect(fixture).toBeDefined();
    expect(fixture.compilerVersion).toBe(SAFETY_COMPILER_VERSION);
  });

  it('should compile valid natural language rules', () => {
    const fixture = loadJsonFixture<SafetyPolicyFixture>(FIXTURES.SAFETY_POLICY);
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
    const fixture = loadJsonFixture<SafetyPolicyFixture>(FIXTURES.SAFETY_POLICY);
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

  it.todo('should filter PII content');
  it.todo('should fail closed on engine error');
  it.todo('should pass safe content through');
});
