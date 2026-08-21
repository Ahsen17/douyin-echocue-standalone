import { describe, it, expect } from 'vitest';
import {
  runRoutingBenchmark,
  validateBenchmarkSamples,
  type BenchmarkDataset,
  type BenchmarkSample,
} from '../../../src/main/benchmark/index.js';
import { PersonaRouterUnavailableError, type PersonaRoutingData } from '../../../src/main/persona/index.js';
import { loadJsonFixture, FIXTURES } from '../../fixtures/index.js';

const TEAM: PersonaRoutingData[] = [
  {
    personaId: 'principal',
    displayName: '阿远',
    isPrincipal: true,
    aliases: [{ aliasText: '阿远', aliasKind: 'NAME', enabled: true }],
  },
  {
    personaId: 'xiaohong',
    displayName: '小红',
    isPrincipal: false,
    aliases: [{ aliasText: '小红', aliasKind: 'NICKNAME', enabled: true }],
  },
];

function sample(overrides: Partial<BenchmarkSample> = {}): BenchmarkSample {
  return {
    caseId: 'c1',
    text: '小红今天状态真好',
    expectedSafetyAction: 'allow',
    expectedSafetyReason: null,
    mentionedPersonaId: 'xiaohong',
    expectedPersonaId: 'xiaohong',
    expectedRouteDecision: 'exact',
    scenario: 'exact',
    ...overrides,
  };
}

describe('runRoutingBenchmark', () => {
  it('passes an exact match', () => {
    const result = runRoutingBenchmark([sample()], TEAM);
    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.wrong).toBe(0);
  });

  it('flags a wrong persona', () => {
    const result = runRoutingBenchmark(
      [sample({ caseId: 'w1', expectedPersonaId: 'principal', expectedRouteDecision: 'principal_fallback' })],
      TEAM,
    );
    expect(result.wrong).toBe(1);
    expect(result.perSample[0].passed).toBe(false);
  });

  it('counts conservative handling for the ambiguous scenario', () => {
    const result = runRoutingBenchmark(
      [
        sample({
          caseId: 'a1',
          text: '小红和阿远一起上吧',
          expectedPersonaId: 'principal',
          expectedRouteDecision: 'principal_fallback',
          scenario: 'ambiguous',
        }),
      ],
      TEAM,
    );
    expect(result.passed).toBe(1);
    const ambiguous = result.byScenario.find((s) => s.scenario === 'ambiguous');
    expect(ambiguous).toMatchObject({ total: 1, passed: 1, conservative: 1, wrong: 0 });
  });

  it('excludes safety-only samples without a routing expectation', () => {
    const result = runRoutingBenchmark(
      [
        sample({ caseId: 's1', text: '你家住址', expectedPersonaId: null, scenario: 'safety' }),
        sample({ caseId: 'r1' }),
      ],
      TEAM,
    );
    expect(result.total).toBe(1);
    expect(result.perSample.map((r) => r.caseId)).toEqual(['r1']);
  });

  it('returns zero totals when every sample is safety-only', () => {
    const result = runRoutingBenchmark(
      [sample({ caseId: 's1', text: '你家住址', expectedPersonaId: null, scenario: 'safety' })],
      TEAM,
    );
    expect(result.total).toBe(0);
    expect(result.passed).toBe(0);
    expect(result.byScenario).toEqual([]);
  });

  it('throws when no principal persona is provided', () => {
    expect(() => runRoutingBenchmark([sample()], [])).toThrowError(PersonaRouterUnavailableError);
  });
});

describe('sample dataset runs green end to end', () => {
  it('passes the bundled demo samples against the bundled demo personas', () => {
    const dataset = loadJsonFixture<BenchmarkDataset>(FIXTURES.BENCHMARK_SAMPLES);
    validateBenchmarkSamples(dataset);
    const personasFixture = loadJsonFixture<{ personas: PersonaRoutingData[] }>(FIXTURES.BENCHMARK_PERSONAS);

    const result = runRoutingBenchmark(dataset.samples, personasFixture.personas);
    expect(result.wrong).toBe(0);
    expect(result.passed).toBe(result.total);
  });
});
