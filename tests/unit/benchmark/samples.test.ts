import { describe, it, expect } from 'vitest';
import {
  validateBenchmarkSamples,
  hashDataset,
  BenchmarkDatasetInvalidError,
  type BenchmarkSample,
  type BenchmarkDataset,
} from '../../../src/main/benchmark/index.js';

function baseSample(overrides: Partial<BenchmarkSample> = {}): BenchmarkSample {
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

function dataset(samples: BenchmarkSample[]): BenchmarkDataset {
  return { schemaVersion: 1, datasetId: 'demo', createdAt: '2026-08-22T00:00:00.000Z', samples };
}

describe('validateBenchmarkSamples', () => {
  it('accepts a valid dataset', () => {
    expect(() => validateBenchmarkSamples(dataset([baseSample()]))).not.toThrow();
  });

  it('rejects a wrong schemaVersion', () => {
    expect(() => validateBenchmarkSamples({ ...dataset([baseSample()]), schemaVersion: 2 })).toThrowError(
      BenchmarkDatasetInvalidError,
    );
  });

  it('rejects an empty samples array', () => {
    expect(() => validateBenchmarkSamples(dataset([]))).toThrowError(BenchmarkDatasetInvalidError);
  });

  it('rejects a missing datasetId', () => {
    expect(() => validateBenchmarkSamples({ schemaVersion: 1, samples: [baseSample()] })).toThrowError(
      BenchmarkDatasetInvalidError,
    );
  });

  it('rejects duplicate caseIds', () => {
    expect(() => validateBenchmarkSamples(dataset([baseSample(), baseSample()]))).toThrowError(
      BenchmarkDatasetInvalidError,
    );
  });

  it('rejects an invalid scenario', () => {
    expect(() => validateBenchmarkSamples(dataset([baseSample({ scenario: 'nope' as never })]))).toThrowError(
      BenchmarkDatasetInvalidError,
    );
  });

  it('rejects an invalid expectedSafetyReason', () => {
    expect(() =>
      validateBenchmarkSamples(dataset([baseSample({ expectedSafetyReason: 'NOPE' as never })])),
    ).toThrowError(BenchmarkDatasetInvalidError);
  });

  it('rejects an invalid expectedSafetyAction', () => {
    expect(() =>
      validateBenchmarkSamples(dataset([baseSample({ expectedSafetyAction: 'both' as never })])),
    ).toThrowError(BenchmarkDatasetInvalidError);
  });

  it('rejects filter without a safety reason', () => {
    expect(() =>
      validateBenchmarkSamples(dataset([baseSample({ expectedSafetyAction: 'filter' })])),
    ).toThrowError(BenchmarkDatasetInvalidError);
  });

  it('rejects allow with a safety reason', () => {
    expect(() =>
      validateBenchmarkSamples(dataset([baseSample({ expectedSafetyReason: 'PII' })])),
    ).toThrowError(BenchmarkDatasetInvalidError);
  });
});

describe('hashDataset', () => {
  it('is deterministic for identical samples', () => {
    const a = dataset([baseSample({ caseId: 'c1' }), baseSample({ caseId: 'c2' })]);
    const b = dataset([baseSample({ caseId: 'c1' }), baseSample({ caseId: 'c2' })]);
    expect(hashDataset(a)).toBe(hashDataset(b));
  });

  it('changes when a sample changes', () => {
    const a = dataset([baseSample()]);
    const b = dataset([baseSample({ text: '改过的文本' })]);
    expect(hashDataset(a)).not.toBe(hashDataset(b));
  });

  it('is key-order independent', () => {
    const ordered = dataset([baseSample({ caseId: 'k1' })]);
    const reordered = dataset([
      Object.fromEntries(Object.entries(baseSample({ caseId: 'k1' })).reverse()) as BenchmarkSample,
    ]);
    expect(hashDataset(ordered)).toBe(hashDataset(reordered));
  });
});
