import { describe, it, expect } from 'vitest';
import type {
  AuditContentTypeV1,
  AuditSnapshotRoleV1,
  AuditWorkflowV1,
} from '@echocue/contracts';
import { GoldenSetPayloadV1Schema } from '@echocue/contracts';
import { uuidv7 } from '../../../src/main/util/uuidv7.js';
import {
  RefluxPayloadError,
  buildGoldenSetPayload,
  buildUpsertPoint,
  computeCaseId,
  computeTargetPointId,
  deriveRefluxAction,
  extractNormalizedText,
  extractSemanticType,
  extractSuggestion,
  readGoldenProfile,
} from '../../../src/main/reflux/index.js';
import type { FeedbackSyncContext } from '../../../src/main/storage/index.js';

const NOW = '2026-08-23T00:00:00.000Z';

function snap(
  role: AuditSnapshotRoleV1,
  contentType: AuditContentTypeV1,
  payload: unknown,
): AuditWorkflowV1['transitions'][number]['snapshots'][number] {
  return { snapshotId: uuidv7(), role, contentType, plaintext: JSON.stringify(payload) };
}

function workflow(...snapshots: AuditWorkflowV1['transitions'][number]['snapshots'][number][]): AuditWorkflowV1 {
  return {
    traceId: uuidv7(),
    transitions: [{
      sequenceNo: 1,
      fromState: 'RECEIVED',
      toState: 'NORMALIZED',
      reasonCode: 'NORMALIZATION_OK',
      occurredAt: NOW,
      snapshots,
    }],
  };
}

const COMMENT = snap('NORMALIZED_COMMENT', 'NORMALIZED_COMMENT_JSON', {
  sourceMessageId: 'm-1',
  rawText: '主播晚上好',
  normalizedText: '主播晚上好',
  receivedAt: NOW,
  receivedMonotonicMs: 1,
});

function baseCtx(overrides: Partial<FeedbackSyncContext> = {}): FeedbackSyncContext {
  return {
    feedbackId: uuidv7(),
    traceId: uuidv7(),
    revisionNo: 1,
    personaId: 'p-1',
    personaVersion: uuidv7(),
    qualityScore: 90,
    labelStatus: 'ACCEPTED',
    correction: null,
    source: { collection: null, pointId: null },
    workflow: workflow(
      COMMENT,
      snap('RERANK_DECISION', 'DECISION_JSON', {
        mergedTopK: [{ payload: { semantic_type: 'positive_praise' } }],
      }),
      snap('DIRECT_PAYLOAD', 'SUGGESTION_JSON', { quick_reply: '谢谢你', cues: ['接住夸奖', '邀请互动'] }),
    ),
    ...overrides,
  };
}

describe('deriveRefluxAction', () => {
  const source = { collection: 'golden_set' as const, pointId: 'golden-1' };

  it('corrected answers always reflux as UPSERT', () => {
    expect(deriveRefluxAction({ labelStatus: 'CORRECTED', score: 50, hasCorrection: true, source }))
      .toBe('UPSERT');
  });

  it('ACCEPTED >=85 refluxes as UPSERT; below stays null', () => {
    expect(deriveRefluxAction({ labelStatus: 'ACCEPTED', score: 85, hasCorrection: false, source: { collection: null, pointId: null } }))
      .toBe('UPSERT');
    expect(deriveRefluxAction({ labelStatus: 'ACCEPTED', score: 84, hasCorrection: false, source: { collection: null, pointId: null } }))
      .toBeNull();
  });

  it('rejected golden direct source → SET_BAD_CASE; other rejections → null', () => {
    expect(deriveRefluxAction({ labelStatus: 'REJECTED', score: 0, hasCorrection: false, source }))
      .toBe('SET_BAD_CASE');
    expect(deriveRefluxAction({ labelStatus: 'REJECTED', score: 0, hasCorrection: false, source: { collection: null, pointId: null } }))
      .toBeNull();
    expect(deriveRefluxAction({ labelStatus: 'REJECTED', score: 0, hasCorrection: false, source: { collection: 'golden_set', pointId: null } }))
      .toBeNull();
  });
});

describe('computeCaseId / computeTargetPointId', () => {
  it('anchors ids to the stable feedback_id so overwrites reuse the same point', () => {
    const caseId = computeCaseId('fb-1');
    expect(caseId).toBe('feedback:fb-1');
    expect(computeTargetPointId(caseId)).toBe(computeTargetPointId(caseId));
    // Different feedback records (different traces) never collide on a point id.
    expect(computeTargetPointId(computeCaseId('fb-2'))).not.toBe(computeTargetPointId(caseId));
  });
});

describe('buildGoldenSetPayload', () => {
  it('uses the corrected answer for CORRECTED feedback', () => {
    const ctx = baseCtx({
      labelStatus: 'CORRECTED',
      qualityScore: 85,
      correction: { correctedQuickReply: '更优答案', correctedCues: ['引导互动', '感谢支持'] },
    });
    const payload = buildGoldenSetPayload(ctx, NOW);
    expect(payload.reply).toBe('更优答案');
    expect(payload.cues).toEqual(['引导互动', '感谢支持']);
    expect(payload.quality_score).toBe(85);
  });

  it('uses DIRECT_PAYLOAD (snake_case) for an accepted direct push', () => {
    const payload = buildGoldenSetPayload(baseCtx(), NOW);
    expect(payload.reply).toBe('谢谢你');
    expect(payload.cues).toEqual(['接住夸奖', '邀请互动']);
  });

  it('uses LLM_PARSED_OUTPUT (camelCase) for an accepted LLM path', () => {
    const ctx = baseCtx({
      workflow: workflow(
        COMMENT,
        snap('RERANK_DECISION', 'DECISION_JSON', {
          mergedTopK: [{ payload: { semantic_type: 'funny_joke' } }],
        }),
        snap('LLM_PARSED_OUTPUT', 'SUGGESTION_JSON', { quickReply: '哈哈你真会聊天', cues: ['接梗', '回夸'] }),
      ),
    });
    const payload = buildGoldenSetPayload(ctx, NOW);
    expect(payload.reply).toBe('哈哈你真会聊天');
    expect(payload.cues).toEqual(['接梗', '回夸']);
    expect(payload.semantic_type).toBe('funny_joke');
  });

  it('passes persona/score through, marks enabled and not a bad case, and validates the schema', () => {
    const ctx = baseCtx();
    const payload = buildGoldenSetPayload(ctx, NOW);
    expect(payload.persona_id).toBe('p-1');
    expect(payload.persona_version).toBe(ctx.personaVersion);
    expect(payload.source_trace_id).toBe(ctx.traceId);
    expect(payload.enabled).toBe(true);
    expect(payload.is_bad_case).toBe(false);
    expect(payload.case_id).toBe(computeCaseId(ctx.feedbackId));
    expect(payload.created_at).toBe(NOW);
    expect(payload.updated_at).toBe(NOW);
    expect(GoldenSetPayloadV1Schema.parse(payload)).toBeDefined();
  });

  it('truncates text/reply/cues to the contract caps', () => {
    const ctx = baseCtx({
      workflow: workflow(
        snap('NORMALIZED_COMMENT', 'NORMALIZED_COMMENT_JSON', {
          normalizedText: '长'.repeat(300),
        }),
        snap('DIRECT_PAYLOAD', 'SUGGESTION_JSON', {
          quick_reply: '回'.repeat(100),
          cues: ['c'.repeat(50), 'd'.repeat(30), 'e'.repeat(20), 'f'.repeat(10)],
        }),
      ),
    });
    const payload = buildGoldenSetPayload(ctx, NOW);
    expect(payload.text).toHaveLength(200);
    expect(payload.reply).toHaveLength(80);
    expect(payload.cues).toEqual(['c'.repeat(40), 'd'.repeat(30), 'e'.repeat(20)]);
  });

  it('falls back to low_value when no semantic decision exists', () => {
    const ctx = baseCtx({
      workflow: workflow(
        COMMENT,
        snap('DIRECT_PAYLOAD', 'SUGGESTION_JSON', { quick_reply: '谢谢你', cues: ['接住夸奖', '邀请互动'] }),
      ),
    });
    expect(buildGoldenSetPayload(ctx, NOW).semantic_type).toBe('low_value');
  });

  it('is a permanent error when an accepted label has no suggestion snapshot', () => {
    const ctx = baseCtx({ workflow: workflow(COMMENT, snap('RERANK_DECISION', 'DECISION_JSON', { mergedTopK: [] })) });
    expect(() => buildGoldenSetPayload(ctx, NOW)).toThrow(RefluxPayloadError);
  });

  it('is a permanent error when CORRECTED has no correction', () => {
    const ctx = baseCtx({ labelStatus: 'CORRECTED', correction: null });
    expect(() => buildGoldenSetPayload(ctx, NOW)).toThrow(RefluxPayloadError);
  });

  it('is a permanent error when there are fewer than 2 cues', () => {
    const ctx = baseCtx({
      workflow: workflow(
        COMMENT,
        snap('DIRECT_PAYLOAD', 'SUGGESTION_JSON', { quick_reply: '好', cues: ['只有一条'] }),
      ),
    });
    expect(() => buildGoldenSetPayload(ctx, NOW)).toThrow(RefluxPayloadError);
  });
});

describe('buildUpsertPoint', () => {
  it('builds a Qdrant point with deterministic id and a bm25 sparse vector', () => {
    const ctx = baseCtx();
    const profile = { k1: 1.2, b: 0.75, avgDocLenBaseline: 4 };
    const pipeline = {
      analyze: (text: string) => ({ tokens: [text], tf: new Map([[text, 1]]), docLen: 1 }),
    };
    const point = buildUpsertPoint(ctx, profile, pipeline as never, NOW);
    expect(point.id).toBe(computeTargetPointId(computeCaseId(ctx.feedbackId)));
    expect(point.vector.bm25_zh_jieba_v1.indices.length).toBeGreaterThan(0);
    expect(point.vector.bm25_zh_jieba_v1.values.length).toBe(point.vector.bm25_zh_jieba_v1.indices.length);
    expect(point.payload.reply).toBe('谢谢你');
  });
});

describe('extract* helpers', () => {
  it('extracts and truncates normalized text', () => {
    const wf = workflow(snap('NORMALIZED_COMMENT', 'NORMALIZED_COMMENT_JSON', { normalizedText: 'x'.repeat(500) }));
    expect(extractNormalizedText(wf)).toHaveLength(200);
    expect(() => extractNormalizedText(workflow())).toThrow(RefluxPayloadError);
  });

  it('extracts the top semantic type and falls back to low_value', () => {
    expect(extractSemanticType(workflow(snap('RERANK_DECISION', 'DECISION_JSON', {
      mergedTopK: [{ payload: { semantic_type: 'interactive_question' } }],
    })))).toBe('interactive_question');
    expect(extractSemanticType(workflow(snap('RERANK_DECISION', 'DECISION_JSON', { mergedTopK: [] })))).toBe('low_value');
    expect(extractSemanticType(workflow())).toBe('low_value');
  });

  it('prefers DIRECT_PAYLOAD then LLM_PARSED_OUTPUT for the suggestion', () => {
    const direct = workflow(snap('DIRECT_PAYLOAD', 'SUGGESTION_JSON', { quick_reply: 'a', cues: ['1', '2'] }));
    const llm = workflow(snap('LLM_PARSED_OUTPUT', 'SUGGESTION_JSON', { quickReply: 'b', cues: ['3', '4'] }));
    expect(extractSuggestion(direct)).toEqual({ quickReply: 'a', cues: ['1', '2'] });
    expect(extractSuggestion(llm)).toEqual({ quickReply: 'b', cues: ['3', '4'] });
    expect(extractSuggestion(workflow())).toBeNull();
  });
});

describe('readGoldenProfile', () => {
  it('reads a valid profile from collection metadata', () => {
    expect(readGoldenProfile({ config: { metadata: { bm25_k1: 1.2, bm25_b: 0.75, avg_doc_len_baseline: 4 } } }))
      .toEqual({ k1: 1.2, b: 0.75, avgDocLenBaseline: 4 });
  });

  it('rejects missing or invalid metadata', () => {
    expect(() => readGoldenProfile({ config: { metadata: {} } })).toThrow(RefluxPayloadError);
    expect(() => readGoldenProfile({ config: { metadata: null } })).toThrow(RefluxPayloadError);
    expect(() => readGoldenProfile({ config: { metadata: { bm25_k1: -1, bm25_b: 0.75, avg_doc_len_baseline: 4 } } }))
      .toThrow(RefluxPayloadError);
    expect(() => readGoldenProfile({})).toThrow(RefluxPayloadError);
  });
});
