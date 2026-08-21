import { describe, it, expect } from 'vitest';
import {
  runSafetyBenchmark,
  runFailClosedCheck,
  validateBenchmarkSamples,
  type BenchmarkDataset,
  type BenchmarkSample,
} from '../../../src/main/benchmark/index.js';
import type { CompiledSafetyRuleV1 } from '../../../src/main/safety/index.js';
import { loadJsonFixture, FIXTURES } from '../../fixtures/index.js';

function sample(overrides: Partial<BenchmarkSample> = {}): BenchmarkSample {
  return {
    caseId: 'c1',
    text: '今天状态真好，给大家分享一下吧',
    expectedSafetyAction: 'allow',
    expectedSafetyReason: null,
    mentionedPersonaId: null,
    expectedPersonaId: null,
    scenario: 'safety',
    ...overrides,
  };
}

const RULES: CompiledSafetyRuleV1[] = [
  { ruleType: 'KEYWORD', category: 'TEAM_FORBIDDEN', text: '机密' },
];

describe('runSafetyBenchmark', () => {
  it('classifies a miss when an expected filter is allowed', () => {
    const result = runSafetyBenchmark(
      [sample({ caseId: 'm1', text: '普通安全文本', expectedSafetyAction: 'filter', expectedSafetyReason: 'TEAM_FORBIDDEN' })],
      [],
    );
    expect(result.total).toBe(1);
    expect(result.missed).toBe(1);
    expect(result.passed).toBe(0);
    expect(result.perSample[0].failure).toBe('miss');
  });

  it('classifies a false positive when an expected allow is filtered', () => {
    const result = runSafetyBenchmark(
      [sample({ caseId: 'f1', text: '你家具体住址和手机号是多少' })],
      [],
    );
    expect(result.falsePositive).toBe(1);
    expect(result.perSample[0].failure).toBe('false_positive');
  });

  it('classifies a wrong reason when the filter category differs', () => {
    const result = runSafetyBenchmark(
      [
        sample({
          caseId: 'w1',
          text: '你家住址在哪里',
          expectedSafetyAction: 'filter',
          expectedSafetyReason: 'TRANSACTION_PRICE',
        }),
      ],
      [],
    );
    expect(result.wrongReason).toBe(1);
    expect(result.perSample[0].failure).toBe('wrong_reason');
  });

  it('aggregates per-category miss/false-positive counts', () => {
    const result = runSafetyBenchmark(
      [
        sample({ caseId: 'a1', text: '你家住址', expectedSafetyAction: 'filter', expectedSafetyReason: 'PII' }),
        sample({ caseId: 'a2', text: '手机号多少', expectedSafetyAction: 'filter', expectedSafetyReason: 'PII' }),
        sample({ caseId: 'a3', text: '普通安全文本', expectedSafetyAction: 'filter', expectedSafetyReason: 'PII' }),
      ],
      [],
    );
    const pii = result.byCategory.find((c) => c.category === 'PII');
    expect(pii).toMatchObject({ total: 3, expectedFilter: 3, actualFilter: 2, missed: 1, falsePositive: 0 });
  });

  it('hits a compiled rule when provided', () => {
    const result = runSafetyBenchmark(
      [sample({ caseId: 'k1', text: '不要聊机密', expectedSafetyAction: 'filter', expectedSafetyReason: 'TEAM_FORBIDDEN' })],
      RULES,
    );
    expect(result.passed).toBe(1);
    expect(result.perSample[0].decision.reason).toBe('TEAM_FORBIDDEN');
  });
});

describe('runSafetyBenchmark', () => {
  it('handles an empty samples list', () => {
    const result = runSafetyBenchmark([], []);
    expect(result).toEqual({
      total: 0,
      passed: 0,
      missed: 0,
      falsePositive: 0,
      wrongReason: 0,
      byCategory: [],
      perSample: [],
    });
  });
});

describe('runFailClosedCheck', () => {
  it('handles an empty samples list', () => {
    expect(runFailClosedCheck([])).toEqual({ total: 0, passed: 0, failed: 0, perSample: [] });
  });

  it('fails closed for every sample with a missing policy', () => {
    const result = runFailClosedCheck([
      sample({ caseId: 'x1', text: '你家住址' }),
      sample({ caseId: 'x2', text: '今天状态真好' }),
    ]);
    expect(result).toEqual({ total: 2, passed: 2, failed: 0, perSample: [{ caseId: 'x1', closed: true }, { caseId: 'x2', closed: true }] });
  });
});

describe('sample dataset runs green end to end', () => {
  it('passes the bundled demo samples against the bundled demo policy', () => {
    const dataset = loadJsonFixture<BenchmarkDataset>(FIXTURES.BENCHMARK_SAMPLES);
    validateBenchmarkSamples(dataset);
    const policy = loadJsonFixture<{ compiledRules: CompiledSafetyRuleV1[] }>(FIXTURES.BENCHMARK_POLICY);

    const safety = runSafetyBenchmark(dataset.samples, policy.compiledRules);
    expect(safety.missed).toBe(0);
    expect(safety.falsePositive).toBe(0);
    expect(safety.wrongReason).toBe(0);
    expect(safety.passed).toBe(dataset.samples.length);

    const failClosed = runFailClosedCheck(dataset.samples);
    expect(failClosed.failed).toBe(0);
  });
});
