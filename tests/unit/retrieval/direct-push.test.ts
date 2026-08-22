import { describe, expect, it } from 'vitest';
import type { GoldenSetPayloadV1, RetrievalHitV1 } from '@echocue/contracts';
import {
  buildRetrievalResult,
  evaluateDirectPush,
} from '../../../src/main/retrieval/index.js';

const GOLDEN_PAYLOAD: GoldenSetPayloadV1 = {
  case_id: 'golden-000001',
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
};

const PRE_PAYLOAD = {
  schema_version: '1.0',
  case_id: 'pre-000001',
  tokenizer_version: 'zh_jieba_search_v1',
  text: '今天状态真好',
  semantic_type: 'positive_praise',
  description: '夸赞',
  enabled: true,
  is_bad_case: false,
} as const;

const CTX = {
  personaId: 'p-1',
  personaVersion: GOLDEN_PAYLOAD.persona_version,
  directPushThreshold: 0.85,
};

function goldenHit(overrides: Partial<RetrievalHitV1> = {}): RetrievalHitV1 {
  return {
    pointId: 'golden-000001',
    caseId: 'golden-000001',
    collection: 'golden_set',
    rawScore: 9.5,
    retrievalConfidence: 0.98,
    rank: 1,
    payload: GOLDEN_PAYLOAD,
    ...overrides,
  };
}

function preHit(overrides: Partial<RetrievalHitV1> = {}): RetrievalHitV1 {
  return {
    pointId: 'pre-000001',
    caseId: 'pre-000001',
    collection: 'pre_set',
    rawScore: 12.5,
    retrievalConfidence: 0.998,
    rank: 1,
    payload: PRE_PAYLOAD,
    ...overrides,
  };
}

describe('evaluateDirectPush', () => {
  it('pushes a current-version golden top1 above the threshold directly', () => {
    expect(evaluateDirectPush([goldenHit()], CTX)).toEqual({
      eligible: true,
      pointId: 'golden-000001',
      reason: 'GOLDEN_DIRECT_ELIGIBLE',
    });
  });

  it('never pushes a pre_set top1', () => {
    expect(evaluateDirectPush([preHit()], CTX)).toEqual({
      eligible: false,
      reason: 'LLM_REQUIRED',
    });
  });

  it('routes to LLM when golden confidence is below the threshold', () => {
    const hit = goldenHit({ retrievalConfidence: 0.5 });
    expect(evaluateDirectPush([hit], CTX)).toEqual({ eligible: false, reason: 'LLM_REQUIRED' });
  });

  it('pushes directly when golden confidence equals the threshold', () => {
    const hit = goldenHit({ retrievalConfidence: CTX.directPushThreshold });
    expect(evaluateDirectPush([hit], CTX).eligible).toBe(true);
  });

  it('routes to LLM for an empty mergedTopK', () => {
    expect(evaluateDirectPush([], CTX)).toEqual({ eligible: false, reason: 'LLM_REQUIRED' });
  });

  it('routes to LLM when the golden payload is a bad case', () => {
    const payload = { ...GOLDEN_PAYLOAD, is_bad_case: true };
    expect(evaluateDirectPush([goldenHit({ payload })], CTX)).toEqual({
      eligible: false,
      reason: 'LLM_REQUIRED',
    });
  });

  it('routes to LLM when the golden payload is disabled', () => {
    const payload = { ...GOLDEN_PAYLOAD, enabled: false };
    expect(evaluateDirectPush([goldenHit({ payload })], CTX)).toEqual({
      eligible: false,
      reason: 'LLM_REQUIRED',
    });
  });

  it('routes to LLM when the golden payload belongs to another persona version', () => {
    const payload = { ...GOLDEN_PAYLOAD, persona_version: '01932a3b-4c5d-7000-8000-000000000099' };
    expect(evaluateDirectPush([goldenHit({ payload })], CTX)).toEqual({
      eligible: false,
      reason: 'LLM_REQUIRED',
    });
  });

  it('routes to LLM when the golden payload belongs to another persona', () => {
    const payload = { ...GOLDEN_PAYLOAD, persona_id: 'p-2' };
    expect(evaluateDirectPush([goldenHit({ payload })], CTX)).toEqual({
      eligible: false,
      reason: 'LLM_REQUIRED',
    });
  });

  it('rejects a threshold outside [0,1]', () => {
    expect(() => evaluateDirectPush([goldenHit()], { ...CTX, directPushThreshold: 1.5 })).toThrow(
      /directPushThreshold must be a finite number within \[0,1\]/,
    );
    expect(() => evaluateDirectPush([goldenHit()], { ...CTX, directPushThreshold: -0.1 })).toThrow(
      /directPushThreshold must be a finite number within \[0,1\]/,
    );
    expect(() => evaluateDirectPush([goldenHit()], { ...CTX, directPushThreshold: Number.NaN })).toThrow(
      /directPushThreshold must be a finite number within \[0,1\]/,
    );
  });
});

describe('buildRetrievalResult', () => {
  it('assembles a valid RetrievalResultV1 with an eligible direct push', () => {
    const hit = goldenHit();
    const result = buildRetrievalResult({
      traceId: '01932a3b-4c5d-7000-8000-000000000010',
      calibrationVersion: 'v1.0',
      goldenHits: [hit],
      preHits: [],
      mergedTopK: [hit],
      directPush: { eligible: true, pointId: 'golden-000001', reason: 'GOLDEN_DIRECT_ELIGIBLE' },
    });
    expect(result.directPushEligible).toBe(true);
    expect(result.directPointId).toBe('golden-000001');
    expect(result.mergedTopK[0].collection).toBe('golden_set');
  });

  it('omits directPointId when not eligible', () => {
    const hit = preHit();
    const result = buildRetrievalResult({
      traceId: '01932a3b-4c5d-7000-8000-000000000011',
      calibrationVersion: 'v1.0',
      goldenHits: [],
      preHits: [hit],
      mergedTopK: [hit],
      directPush: { eligible: false, reason: 'LLM_REQUIRED' },
    });
    expect(result.directPushEligible).toBe(false);
    expect(result.directPointId).toBeUndefined();
  });

  it('throws on an invalid result (bad traceId)', () => {
    const hit = goldenHit();
    expect(() =>
      buildRetrievalResult({
        traceId: 'not-a-uuid',
        calibrationVersion: 'v1.0',
        goldenHits: [hit],
        preHits: [],
        mergedTopK: [hit],
        directPush: { eligible: true, pointId: 'golden-000001', reason: 'GOLDEN_DIRECT_ELIGIBLE' },
      }),
    ).toThrow();
  });

  it('rejects an ineligible direct push that still carries a pointId', () => {
    const hit = preHit();
    expect(() =>
      buildRetrievalResult({
        traceId: '01932a3b-4c5d-7000-8000-000000000012',
        calibrationVersion: 'v1.0',
        goldenHits: [],
        preHits: [hit],
        mergedTopK: [hit],
        directPush: { eligible: false, pointId: 'pre-000001', reason: 'LLM_REQUIRED' },
      }),
    ).toThrow(/ineligible direct push must not carry a pointId/);
  });
});
