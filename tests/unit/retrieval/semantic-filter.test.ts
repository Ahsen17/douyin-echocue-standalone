import { describe, expect, it } from 'vitest';
import type { RetrievalHitV1, SemanticTypeV1 } from '@echocue/contracts';
import { evaluateSemanticFilter } from '../../../src/main/retrieval/index.js';
import type { CalibrationArtifactV1 } from '../../../src/main/retrieval/index.js';

const ARTIFACT: CalibrationArtifactV1 = {
  artifactId: 'test',
  version: 'v1',
  preSet: { center: 0, scale: 2 },
  goldenSet: { center: 0, scale: 2 },
  semanticDiscardConfidence: 0.9,
};

function hit(pointId: string, rawScore: number, semanticType: SemanticTypeV1, collection: 'pre_set' | 'golden_set' = 'pre_set'): RetrievalHitV1 {
  const isGolden = collection === 'golden_set';
  return {
    pointId,
    caseId: pointId,
    collection,
    rawScore,
    retrievalConfidence: 1 / (1 + Math.exp(-rawScore / 2)),
    rank: 1,
    payload: isGolden
      ? {
          case_id: pointId,
          tokenizer_version: 'zh_jieba_search_v1',
          source_trace_id: '01932a3b-4c5d-7000-8000-000000000001',
          persona_id: 'p-1',
          persona_version: '01932a3b-4c5d-7000-8000-000000000002',
          text: '中性文本',
          semantic_type: semanticType,
          reply: '回复',
          cues: ['提词一', '提词二'],
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
          semantic_type: semanticType,
          description: '描述',
          enabled: true,
          is_bad_case: false,
        },
  };
}

// raw 9 → sigmoid conf ≈ 0.989; raw 7 → ≈ 0.970; raw 1 → ≈ 0.622; raw 0 → 0.5
describe('evaluateSemanticFilter', () => {
  it('discards when a low_value hit is confident and no positive hit is higher', () => {
    const decision = evaluateSemanticFilter(
      [hit('l1', 9, 'low_value'), hit('p1', 1, 'positive_praise')],
      ARTIFACT,
    );
    expect(decision.action).toBe('DISCARD');
    expect(decision.reason).toBe('LOW_VALUE');
    expect(decision.discardedBy).toBe('low_value');
    expect(decision.topSemanticType).toBe('low_value');
  });

  it('discards when a filter_risk hit is confident and no positive hit is higher', () => {
    const decision = evaluateSemanticFilter([hit('f1', 9, 'filter_risk')], ARTIFACT);
    expect(decision.action).toBe('DISCARD');
    expect(decision.discardedBy).toBe('filter_risk');
  });

  it('keeps candidate when a positive hit has higher confidence than the discard-type hit', () => {
    const decision = evaluateSemanticFilter(
      [hit('p1', 9, 'positive_praise'), hit('l1', 1, 'low_value')],
      ARTIFACT,
    );
    expect(decision.action).toBe('CANDIDATE');
  });

  it('keeps candidate when the discard-type confidence is below the threshold', () => {
    const decision = evaluateSemanticFilter([hit('l1', 1, 'low_value')], ARTIFACT);
    expect(decision.action).toBe('CANDIDATE');
  });

  it('keeps candidate when discard-type and positive-type confidences are equal (gray zone)', () => {
    const low = hit('l1', 9, 'low_value');
    const positive = hit('p1', 9, 'positive_praise');
    const decision = evaluateSemanticFilter([low, positive], ARTIFACT);
    expect(decision.action).toBe('CANDIDATE');
  });

  it('returns candidate with topSemanticType for an empty topK', () => {
    const decision = evaluateSemanticFilter([], ARTIFACT);
    expect(decision).toEqual({ action: 'CANDIDATE', topSemanticType: 'low_value' });
  });

  it('reports the top hit semantic type as the conclusion type', () => {
    const decision = evaluateSemanticFilter([hit('j1', 9, 'funny_joke')], ARTIFACT);
    expect(decision.topSemanticType).toBe('funny_joke');
    expect(decision.action).toBe('CANDIDATE');
  });

  it('treats an unknown semantic_type as a gray zone (candidate), not as discardable', () => {
    const malformed = hit('x1', 9, 'low_value');
    (malformed.payload as { semantic_type: string }).semantic_type = 'unknown_category';
    const decision = evaluateSemanticFilter([malformed], ARTIFACT);
    expect(decision.action).toBe('CANDIDATE');
  });
});
