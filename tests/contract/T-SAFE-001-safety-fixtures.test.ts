import { describe, it, expect } from 'vitest';
import { loadJsonFixture, FIXTURES } from '../fixtures/index.js';
import {
  compilePolicy,
  compileRiskFilter,
  SAFETY_COMPILER_VERSION,
  normalizeComment,
  evaluateInputSafety,
  type CompiledSafetyRuleV1,
} from '../../src/main/safety/index.js';
import { SuggestionOutputValidator } from '../../src/main/validation/index.js';
import type {
  CandidateSuggestion,
  OutputValidationContext,
  TeamMemberNameV1,
} from '../../src/main/validation/index.js';

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

interface RuntimeRiskTypeFixture {
  typeId: string;
  label: string;
  keywords: string[];
}

interface RuntimeCaseFixture {
  id: string;
  stage: 'INPUT' | 'OUTPUT';
  text?: string;
  compiledRules?: RuntimeRuleFixture[];
  riskFilter?: RuntimeRiskTypeFixture[];
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
        riskFilter: c.riskFilter === undefined ? undefined : compileRiskFilter(c.riskFilter),
      });
      expect(decision.allow).toBe(c.expected.allow);
      if (c.expected.allow) {
        expect(decision.reason).toBeNull();
      } else {
        expect(decision.reason).toBe(c.expected.reason as never);
      }
    }
  });

  // DELIVERY §4.2/§4.4: input AND output re-verification. The OUTPUT-stage case
  // (`unsafe-output-discarded`) is driven through the shared output validator
  // (SuggestionOutputValidator step 5 re-checks reply+cues against the same
  // compiled rules), which is the production path that maps an unsafe output to
  // a DISCARDED trace. Only tests are added here; the fixture text was corrected
  // so the case actually triggers the PII detector (M7-04).
  describe('OUTPUT stage re-verification', () => {
    const outputCase = fixture.runtimeCases.find((r) => r.stage === 'OUTPUT');
    const validator = new SuggestionOutputValidator();
    const members: readonly TeamMemberNameV1[] = [
      { personaId: 'p-1', displayName: '主播A', enabledAliases: [] },
    ];

    function outputContext(
      compiledRules: CompiledSafetyRuleV1[] | null,
      riskFilter?: RuntimeRiskTypeFixture[],
    ): OutputValidationContext {
      return {
        source: 'llm',
        personaSnapshot: {
          personaId: 'p-1',
          personaVersion: '01932a3b-4c5d-7000-8000-000000000001',
          content: '你是一个温柔的主播。',
          contentHmac: 'hmac-v1',
        },
        safetySnapshot: { version: 'pol-v1', policyText: '', keywords: [] },
        compiledRules,
        riskFilter: riskFilter === undefined ? undefined : compileRiskFilter(riskFilter),
        memberNames: members,
        currentPersonaId: 'p-1',
        forbiddenPromiseTerms: [],
        expected: { sessionId: 's1', traceId: 't1', windowVersion: 1 },
        actual: { sessionId: 's1', traceId: 't1', windowVersion: 1 },
        nowMonotonicMs: 1000,
        freshnessDeadlineMonotonicMs: 10000,
      };
    }

    it('rejects the unsafe-output fixture through the shared output validator', () => {
      expect(outputCase).toBeDefined();
      if (outputCase === undefined || outputCase.text === undefined) return;
      const candidate: CandidateSuggestion = {
        quick_reply: normalizeComment(outputCase.text),
        cues: ['接住夸奖', '继续互动'],
      };
      // WP-10: the OUTPUT case carries a configured risk filter (was the built-in
      // PII detector); its typeId is literally 'PII', which the validator maps to
      // PERSONAL_INFO_HIT.
      const result = validator.validate(candidate, outputContext(outputCase.compiledRules ?? [], outputCase.riskFilter));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('REJECTED');
        if (result.kind === 'REJECTED') {
          expect(result.reasonCodes).toContain('PERSONAL_INFO_HIT');
        }
      }
    });

    it('does not false-positive a benign output through the same path', () => {
      const result = validator.validate(
        { quick_reply: '谢谢你一直在呀', cues: ['接住陪伴', '自然带动互动'] },
        outputContext([]),
      );
      expect(result.ok).toBe(true);
    });

    it('fails closed when the safety engine is unavailable (compiledRules null)', () => {
      const result = validator.validate(
        { quick_reply: '谢谢你一直在呀', cues: ['接住陪伴', '自然带动互动'] },
        outputContext(null),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('REJECTED');
        if (result.kind === 'REJECTED') {
          expect(result.reasonCodes).toContain('RISK_RULE_HIT');
        }
      }
    });
  });
});
