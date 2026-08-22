import { describe, expect, it } from 'vitest';
import type {
  OutputValidationReasonV1,
  SuggestionSourceV1,
} from '@echocue/contracts';
import { SuggestionOutputValidator } from '../../src/main/validation/index.js';
import type {
  CandidateSuggestion,
  OutputValidationContext,
} from '../../src/main/validation/index.js';
import { FIXTURES, loadJsonFixture } from '../fixtures/loader.js';

interface TeamMemberFixture {
  personaId: string;
  displayName: string;
  enabledAliases: string[];
}

interface ContextDefaultsFixture {
  expected: { sessionId: string; traceId: string; windowVersion: number };
  actual: { sessionId: string; traceId: string; windowVersion: number };
  nowMonotonicMs: number;
  freshnessDeadlineMonotonicMs: number;
}

interface OutputValidationFixture {
  schemaVersion: number;
  validatorVersion: string;
  defaults: {
    persona: Record<string, unknown>;
    safety: Record<string, unknown>;
    members: TeamMemberFixture[];
    forbiddenPromiseTerms: string[];
    context: ContextDefaultsFixture;
  };
  cases: Array<{
    id: string;
    source?: SuggestionSourceV1;
    candidate: CandidateSuggestion;
    contextOverrides?: {
      actualTraceId?: string;
      actualWindowVersion?: number;
      nowMonotonicMs?: number;
    };
    expected:
      | { ok: true }
      | { ok: false; reasonCodes: OutputValidationReasonV1[] }
      | { ok: false; stale: string };
  }>;
}

const fixture = loadJsonFixture<OutputValidationFixture>(FIXTURES.OUTPUT_VALIDATION);

function buildContext(
  overrides: OutputValidationFixture['cases'][number]['contextOverrides'],
  source: SuggestionSourceV1,
): OutputValidationContext {
  const context = fixture.defaults.context;
  return {
    source,
    personaSnapshot: fixture.defaults.persona as never,
    safetySnapshot: fixture.defaults.safety as never,
    compiledRules: [
      { ruleType: 'KEYWORD', category: 'TEAM_FORBIDDEN', text: '私聊' },
      { ruleType: 'KEYWORD', category: 'TEAM_FORBIDDEN', text: '加微信' },
    ],
    memberNames: fixture.defaults.members,
    currentPersonaId: 'p-1',
    forbiddenPromiseTerms: fixture.defaults.forbiddenPromiseTerms,
    expected: context.expected,
    actual: {
      ...context.actual,
      ...(overrides?.actualTraceId !== undefined ? { traceId: overrides.actualTraceId } : {}),
      ...(overrides?.actualWindowVersion !== undefined
        ? { windowVersion: overrides.actualWindowVersion }
        : {}),
    },
    nowMonotonicMs: overrides?.nowMonotonicMs ?? context.nowMonotonicMs,
    freshnessDeadlineMonotonicMs: context.freshnessDeadlineMonotonicMs,
  };
}

describe('T-PROV-001: Output Validation Fixtures', () => {
  it('loads the fixture and every case drives the shared validator', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
    const validator = new SuggestionOutputValidator();
    for (const c of fixture.cases) {
      const source: SuggestionSourceV1 = c.source ?? 'llm';
      const result = validator.validate(c.candidate, buildContext(c.contextOverrides, source));
      if (c.expected.ok) {
        expect(result.ok, `case ${c.id} should pass`).toBe(true);
        if (result.ok) {
          expect(result.output.source).toBe(source);
        }
      } else if ('stale' in c.expected) {
        expect(result.ok, `case ${c.id} should be stale`).toBe(false);
        if (!result.ok) {
          expect(result.kind).toBe('STALE');
          if (result.kind === 'STALE') expect(result.traceReason).toBe(c.expected.stale);
        }
      } else {
        expect(result.ok, `case ${c.id} should be rejected`).toBe(false);
        if (!result.ok) {
          expect(result.kind).toBe('REJECTED');
          if (result.kind === 'REJECTED') {
            expect(result.reasonCodes).toEqual(expect.arrayContaining(c.expected.reasonCodes));
          }
        }
      }
    }
  });

  it('never leaks candidate content, internal values, or secrets into results', () => {
    const validator = new SuggestionOutputValidator();
    for (const c of fixture.cases) {
      const source: SuggestionSourceV1 = c.source ?? 'llm';
      const result = validator.validate(c.candidate, buildContext(c.contextOverrides, source));
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('Authorization');
      expect(serialized).not.toContain('trace_id');
      expect(serialized).not.toContain('apiKey');
      // reason codes / trace reasons must not echo the candidate text itself
      if (!result.ok) {
        expect(serialized).not.toContain(c.candidate.quick_reply.slice(0, 4));
        for (const cue of c.candidate.cues) {
          expect(serialized).not.toContain(cue.slice(0, 4));
        }
      }
    }
  });
});
