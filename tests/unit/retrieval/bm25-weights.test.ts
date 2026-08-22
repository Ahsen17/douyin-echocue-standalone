import { describe, expect, it } from 'vitest';
import type { Bm25ZhJiebaProfileV1 } from '@echocue/contracts';
import { createBm25TextPipeline } from '../../../src/main/retrieval/index.js';
import {
  BM25_B_INITIAL,
  BM25_K1_INITIAL,
  buildDocumentVector,
  computeAvgDocLenBaseline,
  docTermWeight,
} from '../../../src/main/retrieval/index.js';

const profile: Bm25ZhJiebaProfileV1 = {
  profileId: 'test-profile',
  tokenizerVersion: 'zh_jieba_search_v1',
  normalizationVersion: 'zh_bm25_normalize_v1',
  preSetSha256: 'a'.repeat(64),
  avgDocLenBaseline: 10,
  k1: 1.2,
  b: 0.75,
  qdrantVersion: '1.19.0',
  calibrationArtifactId: 'cal-1',
};

describe('BM25 default parameters', () => {
  it('uses FastEmbed initial values k1=1.2, b=0.75', () => {
    expect(BM25_K1_INITIAL).toBe(1.2);
    expect(BM25_B_INITIAL).toBe(0.75);
  });
});

describe('docTermWeight', () => {
  it('computes the FastEmbed doc-side formula without IDF', () => {
    // tf=2, docLen=10, avg=10: denom = 2 + 1.2*(1-0.75+0.75*1) = 3.2
    expect(docTermWeight(2, 10, profile)).toBeCloseTo((2 * 2.2) / 3.2, 10);
  });

  it('depends only on the document and profile, never on corpus frequency', () => {
    // Same term frequency in a longer document gets a lower weight (length
    // normalization); there is no corpus/df input to the function.
    const short = docTermWeight(1, 5, profile);
    const long = docTermWeight(1, 20, profile);
    expect(short).toBeGreaterThan(long);
  });

  it('weights a repeated term sublinearly in tf', () => {
    expect(docTermWeight(3, 10, profile)).toBeLessThan(3 * docTermWeight(1, 10, profile));
  });
});

describe('computeAvgDocLenBaseline', () => {
  it('averages non-empty input', () => {
    expect(computeAvgDocLenBaseline([10, 20, 30])).toBe(20);
    expect(computeAvgDocLenBaseline([5])).toBe(5);
  });

  it('returns 0 for an empty corpus', () => {
    expect(computeAvgDocLenBaseline([])).toBe(0);
  });
});

describe('buildDocumentVector', () => {
  const pipeline = createBm25TextPipeline();

  it('maps tokens to ids with doc-side weights and no IDF component', () => {
    const analyzed = pipeline.analyze('主播 主播 状态'); // 主播 tf=2, 状态 tf=1
    const vector = buildDocumentVector(analyzed, profile);
    expect(vector.collisions).toEqual([]);
    expect(vector.indices.length).toBe(2);
    const w = (tf: number) => docTermWeight(tf, analyzed.docLen, profile);
    expect(vector.values.reduce((a, b) => a + b, 0)).toBeCloseTo(w(2) + w(1), 10);
  });

  it('detects in-document 32-bit collisions and sums weights for the shared id', () => {
    const analyzed = pipeline.analyze('主播今天状态真好');
    const collidingId = (token: string): number =>
      token === '主播' || token === '状态' ? 7 : 999;
    const vector = buildDocumentVector(analyzed, profile, collidingId);
    expect(vector.collisions).toContainEqual({ tokenA: '主播', tokenB: '状态', id: 7 });
    const valueAt7 = vector.values[vector.indices.indexOf(7)];
    const expected = docTermWeight(analyzed.tf.get('主播') ?? 0, analyzed.docLen, profile)
      + docTermWeight(analyzed.tf.get('状态') ?? 0, analyzed.docLen, profile);
    expect(valueAt7).toBeCloseTo(expected, 10);
  });

  it('sorts indices deterministically', () => {
    const analyzed = pipeline.analyze('今天状态真好');
    const a = buildDocumentVector(analyzed, profile);
    const b = buildDocumentVector(analyzed, profile);
    expect(a.indices).toEqual(b.indices);
    expect(a.values).toEqual(b.values);
    expect([...a.indices]).toEqual([...a.indices].sort((x, y) => x - y));
  });
});
