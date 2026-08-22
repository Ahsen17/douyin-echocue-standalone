import { describe, expect, it } from 'vitest';
import type { RetrievalRawHit } from '../../../src/main/retrieval/index.js';
import { evaluateRetrieval } from '../../../src/main/retrieval/index.js';

function rawHit(pointId: string, rawScore: number, collection: 'pre_set' | 'golden_set'): RetrievalRawHit {
  const isGolden = collection === 'golden_set';
  return {
    pointId,
    caseId: pointId,
    collection,
    rawScore,
    rank: 1,
    payload: isGolden
      ? {
          case_id: pointId,
          tokenizer_version: 'zh_jieba_search_v1',
          source_trace_id: '01932a3b-4c5d-7000-8000-000000000001',
          persona_id: 'p-1',
          persona_version: '01932a3b-4c5d-7000-8000-000000000002',
          text: '今天状态真好',
          semantic_type: 'positive_praise',
          reply: '谢谢你！',
          cues: ['接住夸奖', '继续互动'],
          quality_score: 90,
          enabled: true,
          is_bad_case: false,
          created_at: '2026-08-22T00:00:00.000Z',
          updated_at: '2026-08-22T00:00:00.000Z',
        }
      : {
          schema_version: '1.0',
          case_id: pointId,
          tokenizer_version: 'zh_jieba_search_v1',
          text: '中性文本',
          semantic_type: 'positive_praise',
          description: '描述',
          enabled: true,
          is_bad_case: false,
        },
  };
}

describe('evaluateRetrieval', () => {
  it('returns calibrated hits, mergedTopK, and a semantic decision', () => {
    const raw = {
      preHits: [rawHit('p1', 1, 'pre_set')],
      goldenHits: [rawHit('g1', 9, 'golden_set')],
    };
    const result = evaluateRetrieval(raw);

    expect(result.calibrationVersion).toBe('v1.0');
    expect(result.mergedTopK[0].pointId).toBe('g1');
    expect(result.mergedTopK[0].collection).toBe('golden_set');
    expect(result.mergedTopK[0].retrievalConfidence).toBeGreaterThan(0.5);
    expect(result.goldenHits[0].collection).toBe('golden_set');
    expect(result.preHits[0].collection).toBe('pre_set');
    expect(result.semanticDecision.action).toBe('CANDIDATE');
    expect(result.semanticDecision.topSemanticType).toBe('positive_praise');
  });

  it('passes topK through to the rerank stage', () => {
    const raw = {
      preHits: [rawHit('p1', 9, 'pre_set'), rawHit('p2', 8, 'pre_set'), rawHit('p3', 7, 'pre_set')],
      goldenHits: [] as RetrievalRawHit[],
    };
    const result = evaluateRetrieval(raw, { topK: 2 });
    expect(result.mergedTopK).toHaveLength(2);
  });

  it('defaults to CANDIDATE for empty retrieval', () => {
    const result = evaluateRetrieval({ preHits: [], goldenHits: [] });
    expect(result.mergedTopK).toEqual([]);
    expect(result.semanticDecision.action).toBe('CANDIDATE');
  });
});
