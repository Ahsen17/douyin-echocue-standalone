import { describe, expect, it } from 'vitest';
import type { RetrievalRawHit } from '../../../src/main/retrieval/index.js';
import { rerank } from '../../../src/main/retrieval/index.js';
import type { CalibrationArtifactV1 } from '../../../src/main/retrieval/index.js';

const ARTIFACT: CalibrationArtifactV1 = {
  artifactId: 'test',
  version: 'v1',
  preSet: { center: 0, scale: 2 },
  goldenSet: { center: 0, scale: 2 },
  semanticDiscardConfidence: 0.9,
};

function hit(overrides: Partial<RetrievalRawHit> & { rawScore: number; pointId: string; collection: 'pre_set' | 'golden_set' }): RetrievalRawHit {
  return {
    caseId: `case-${overrides.pointId}`,
    rank: 1,
    payload: {
      schema_version: '1.0',
      case_id: `case-${overrides.pointId}`,
      tokenizer_version: 'zh_jieba_search_v1',
      text: '中性样例文本',
      semantic_type: 'positive_praise',
      description: '描述',
      enabled: true,
      is_bad_case: false,
    },
    ...overrides,
  };
}

describe('rerank', () => {
  it('merges both collections sorted by confidence and assigns unified ranks', () => {
    const pre = [
      hit({ pointId: 'p1', rawScore: 1, collection: 'pre_set', rank: 1 }),
      hit({ pointId: 'p2', rawScore: 9, collection: 'pre_set', rank: 2 }),
    ];
    const golden = [hit({ pointId: 'g1', rawScore: 5, collection: 'golden_set', rank: 1 })];

    const result = rerank({ preHits: pre, goldenHits: golden }, { artifact: ARTIFACT });

    expect(result.mergedTopK.map((h) => h.pointId)).toEqual(['p2', 'g1', 'p1']);
    expect(result.mergedTopK.map((h) => h.rank)).toEqual([1, 2, 3]);
    // per-collection calibrated lists keep the original rank
    expect(result.preHits.map((h) => h.rank)).toEqual([1, 2]);
    expect(result.goldenHits.map((h) => h.rank)).toEqual([1]);
  });

  it('respects topK truncation', () => {
    const pre = [
      hit({ pointId: 'p1', rawScore: 9, collection: 'pre_set', rank: 1 }),
      hit({ pointId: 'p2', rawScore: 8, collection: 'pre_set', rank: 2 }),
      hit({ pointId: 'p3', rawScore: 7, collection: 'pre_set', rank: 3 }),
    ];
    const result = rerank({ preHits: pre, goldenHits: [] }, { artifact: ARTIFACT, topK: 2 });
    expect(result.mergedTopK).toHaveLength(2);
    expect(result.mergedTopK[0].pointId).toBe('p1');
    expect(result.mergedTopK[1].pointId).toBe('p2');
  });

  it('returns empty mergedTopK for empty input', () => {
    const result = rerank({ preHits: [], goldenHits: [] }, { artifact: ARTIFACT });
    expect(result.mergedTopK).toEqual([]);
    expect(result.preHits).toEqual([]);
    expect(result.goldenHits).toEqual([]);
  });

  it('breaks ties deterministically by rawScore then pointId', () => {
    const pre = [
      hit({ pointId: 'b', rawScore: 3, collection: 'pre_set', rank: 1 }),
      hit({ pointId: 'a', rawScore: 3, collection: 'pre_set', rank: 2 }),
    ];
    const result = rerank({ preHits: pre, goldenHits: [] }, { artifact: ARTIFACT });
    expect(result.mergedTopK.map((h) => h.pointId)).toEqual(['a', 'b']);
  });

  it('clamps topK to at least one', () => {
    const pre = [hit({ pointId: 'p1', rawScore: 5, collection: 'pre_set', rank: 1 })];
    const result = rerank({ preHits: pre, goldenHits: [] }, { artifact: ARTIFACT, topK: 0 });
    expect(result.mergedTopK).toHaveLength(1);
  });

  it('rejects a non-finite topK instead of returning an empty result', () => {
    const pre = [hit({ pointId: 'p1', rawScore: 5, collection: 'pre_set', rank: 1 })];
    expect(() =>
      rerank({ preHits: pre, goldenHits: [] }, { artifact: ARTIFACT, topK: Number.NaN }),
    ).toThrow(/topK must be a finite number/);
  });

  it('keeps source collection on every merged hit', () => {
    const pre = [hit({ pointId: 'p1', rawScore: 1, collection: 'pre_set', rank: 1 })];
    const golden = [hit({ pointId: 'g1', rawScore: 2, collection: 'golden_set', rank: 1 })];
    const result = rerank({ preHits: pre, goldenHits: golden }, { artifact: ARTIFACT });
    expect(result.mergedTopK.map((h) => h.collection)).toEqual(['golden_set', 'pre_set']);
  });
});
