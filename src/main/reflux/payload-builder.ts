import type {
  AuditContentTypeV1,
  AuditSnapshotRoleV1,
  AuditWorkflowV1,
  GoldenSetPayloadV1,
  LabelStatus,
  OutboxActionV1,
  SemanticTypeV1,
} from '@echocue/contracts';
import {
  BM25_TOKENIZER_VERSION_V1,
  BM25_VECTOR_NAME_V1,
  GoldenSetPayloadV1Schema,
  SemanticTypeV1Schema,
} from '@echocue/contracts';
import { buildDocumentVector } from '../retrieval/index.js';
import type { Bm25TextPipeline } from '../retrieval/index.js';
import type { GoldenProfileParams } from '../retrieval/index.js';
import { uuidv5 } from '../util/uuidv5.js';
import type { FeedbackSyncContext } from '../storage/index.js';

/** Permanent data problem in a reflux job: never auto-retried (M7-03). */
export class RefluxPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefluxPayloadError';
  }
}

export interface DeriveRefluxActionInput {
  labelStatus: LabelStatus;
  score: number;
  hasCorrection: boolean;
  source: { collection: 'golden_set' | null; pointId: string | null };
}

/**
 * DATA §4.3 / ARCH §4.3: which qdrant_sync_job action a label revision creates,
 * or null when the revision stays SQLite-only (low-score accept, or a rejection
 * outside the golden direct source). Called inside submitLabel's transaction, so
 * it must be pure and side-effect free.
 */
export function deriveRefluxAction(input: DeriveRefluxActionInput): OutboxActionV1 | null {
  // A corrected answer always refluxes, regardless of the score.
  if (input.hasCorrection) return 'UPSERT';
  if (input.labelStatus === 'ACCEPTED' && input.score >= 85) return 'UPSERT';
  // Only a rejected golden direct source may be marked bad; the migration
  // trigger re-validates the same condition before the job is inserted.
  if (
    input.labelStatus === 'REJECTED' &&
    input.source.collection === 'golden_set' &&
    input.source.pointId !== null
  ) {
    return 'SET_BAD_CASE';
  }
  return null;
}

// CONTRACT §3: golden point ids are deterministic UUIDv5 over the business case
// id, anchored to the stable feedback_id so re-labeling the same trace
// re-upserts the SAME point (覆盖) instead of stacking duplicate golden points.
export function computeCaseId(feedbackId: string): string {
  return `feedback:${feedbackId}`;
}

export function computeTargetPointId(caseId: string): string {
  return uuidv5(`echocue:golden_set:${caseId}`);
}

function findSnapshot(
  workflow: AuditWorkflowV1,
  role: AuditSnapshotRoleV1,
  contentType?: AuditContentTypeV1,
): string | null {
  for (const transition of workflow.transitions) {
    for (const snapshot of transition.snapshots) {
      if (snapshot.role !== role) continue;
      if (contentType !== undefined && snapshot.contentType !== contentType) continue;
      return snapshot.plaintext;
    }
  }
  return null;
}

// A malformed snapshot is a data-integrity problem, not a transient fault —
// classify it permanent so it surfaces instead of retrying (F3).
function parseSnapshot<T>(plaintext: string, label: string): T {
  try {
    return JSON.parse(plaintext) as T;
  } catch {
    throw new RefluxPayloadError(`${label} snapshot is not valid JSON`);
  }
}

/** The comment text a golden point should match on future queries (≤200). */
export function extractNormalizedText(workflow: AuditWorkflowV1): string {
  const plaintext = findSnapshot(workflow, 'NORMALIZED_COMMENT', 'NORMALIZED_COMMENT_JSON');
  if (plaintext === null) throw new RefluxPayloadError('trace has no NORMALIZED_COMMENT snapshot');
  const parsed = parseSnapshot<{ normalizedText?: unknown }>(plaintext, 'NORMALIZED_COMMENT');
  if (typeof parsed.normalizedText !== 'string' || parsed.normalizedText.length === 0) {
    throw new RefluxPayloadError('NORMALIZED_COMMENT has no non-empty normalizedText');
  }
  return parsed.normalizedText.length > 200 ? parsed.normalizedText.slice(0, 200) : parsed.normalizedText;
}

// The semantic conclusion is the top hit's payload type (semantic-filter.ts
// votes the same way); unknown/missing falls back to low_value, never blocking
// a reflux.
export function extractSemanticType(workflow: AuditWorkflowV1): SemanticTypeV1 {
  const plaintext = findSnapshot(workflow, 'RERANK_DECISION');
  if (plaintext === null) return 'low_value';
  const parsed = parseSnapshot<{
    mergedTopK?: Array<{ payload?: { semantic_type?: unknown } }>;
  }>(plaintext, 'RERANK_DECISION');
  const first = parsed.mergedTopK?.[0]?.payload?.semantic_type;
  if (first !== undefined && SemanticTypeV1Schema.safeParse(first).success) {
    return first as SemanticTypeV1;
  }
  return 'low_value';
}

/**
 * The displayed suggestion's reply/cues. The direct path records snake_case
 * (DIRECT_PAYLOAD.quick_reply), the LLM path camelCase (LLM_PARSED_OUTPUT.quickReply).
 */
export function extractSuggestion(
  workflow: AuditWorkflowV1,
): { quickReply: string; cues: string[] } | null {
  const direct = findSnapshot(workflow, 'DIRECT_PAYLOAD', 'SUGGESTION_JSON');
  if (direct !== null) {
    const parsed = parseSnapshot<{ quick_reply?: unknown; cues?: unknown }>(direct, 'DIRECT_PAYLOAD');
    if (
      typeof parsed.quick_reply === 'string' &&
      Array.isArray(parsed.cues) &&
      parsed.cues.every((cue) => typeof cue === 'string')
    ) {
      return { quickReply: parsed.quick_reply, cues: parsed.cues };
    }
  }
  const llm = findSnapshot(workflow, 'LLM_PARSED_OUTPUT', 'SUGGESTION_JSON');
  if (llm !== null) {
    const parsed = parseSnapshot<{ quickReply?: unknown; cues?: unknown }>(llm, 'LLM_PARSED_OUTPUT');
    if (
      typeof parsed.quickReply === 'string' &&
      Array.isArray(parsed.cues) &&
      parsed.cues.every((cue) => typeof cue === 'string')
    ) {
      return { quickReply: parsed.quickReply, cues: parsed.cues };
    }
  }
  return null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Build the GoldenSetPayloadV1 for an UPSERT job (DATA §6.2). The corrected
 * answer wins for CORRECTED feedback; an ACCEPTED >=85 label reuses the
 * displayed suggestion. Missing required evidence is a permanent error.
 */
export function buildGoldenSetPayload(ctx: FeedbackSyncContext, now: string): GoldenSetPayloadV1 {
  let reply: string;
  let cues: string[];
  if (ctx.labelStatus === 'CORRECTED') {
    if (ctx.correction === null) throw new RefluxPayloadError('CORRECTED feedback has no correction');
    reply = ctx.correction.correctedQuickReply;
    cues = ctx.correction.correctedCues;
  } else {
    const suggestion = extractSuggestion(ctx.workflow);
    if (suggestion === null) {
      throw new RefluxPayloadError('accepted feedback has no suggestion snapshot');
    }
    reply = suggestion.quickReply;
    cues = suggestion.cues;
  }
  const trimmedCues = cues.map((cue) => truncate(cue, 40)).slice(0, 3);
  if (trimmedCues.length < 2) throw new RefluxPayloadError('suggestion has fewer than 2 cues');

  const payload = {
    case_id: computeCaseId(ctx.feedbackId),
    tokenizer_version: BM25_TOKENIZER_VERSION_V1,
    source_trace_id: ctx.traceId,
    persona_id: ctx.personaId,
    persona_version: ctx.personaVersion,
    text: extractNormalizedText(ctx.workflow),
    semantic_type: extractSemanticType(ctx.workflow),
    reply: truncate(reply, 80),
    cues: trimmedCues,
    quality_score: ctx.qualityScore,
    enabled: true,
    is_bad_case: false,
    created_at: now,
    updated_at: now,
  };
  const parsed = GoldenSetPayloadV1Schema.safeParse(payload);
  if (!parsed.success) {
    throw new RefluxPayloadError(`golden payload failed schema: ${JSON.stringify(parsed.error.flatten())}`);
  }
  return parsed.data;
}

export interface UpsertPoint {
  id: string;
  vector: { [BM25_VECTOR_NAME_V1]: { indices: number[]; values: number[] } };
  payload: GoldenSetPayloadV1;
}

/** One golden point ready for client.upsert, vector built from the current profile. */
export function buildUpsertPoint(
  ctx: FeedbackSyncContext,
  profile: GoldenProfileParams,
  pipeline: Bm25TextPipeline,
  now: string,
): UpsertPoint {
  const payload = buildGoldenSetPayload(ctx, now);
  const analyzed = pipeline.analyze(payload.text);
  const vector = buildDocumentVector(analyzed, profile);
  return {
    id: computeTargetPointId(payload.case_id),
    vector: { [BM25_VECTOR_NAME_V1]: { indices: vector.indices, values: vector.values } },
    payload,
  };
}

/**
 * Read the frozen BM25 parameters from the active golden_set collection metadata
 * (written by bootstrap; CONTRACT §4.5 forbids re-deriving a profile).
 */
export function readGoldenProfile(info: { config?: { metadata?: unknown } }): GoldenProfileParams {
  const metadata = (info.config?.metadata ?? {}) as Record<string, unknown>;
  const k1 = Number(metadata.bm25_k1);
  const b = Number(metadata.bm25_b);
  const avgDocLenBaseline = Number(metadata.avg_doc_len_baseline);
  if (!Number.isFinite(k1) || !Number.isFinite(b) || !Number.isFinite(avgDocLenBaseline)) {
    throw new RefluxPayloadError('golden_set metadata is missing BM25 profile parameters');
  }
  if (k1 <= 0 || b < 0 || b > 1 || avgDocLenBaseline <= 0) {
    throw new RefluxPayloadError('golden_set metadata holds an invalid BM25 profile');
  }
  return { k1, b, avgDocLenBaseline };
}
