/**
 * Echocue MVP canonical runtime schemas.
 * Source of truth: Echocue-数据模型、接口与实时事件协议-v0.1.md.
 * Copy into the application contract package; do not maintain a second enum list.
 */
import { z } from 'zod';

const uuidV7 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  'expected UUID v7',
);

export const LabelStatusSchema = z.enum([
  'UNLABELED', 'ACCEPTED', 'REJECTED', 'CORRECTED', 'NOT_APPLICABLE',
]);

export const TraceStateSchema = z.enum([
  'RECEIVED', 'NORMALIZED', 'FILTERED', 'ROUTED', 'RETRIEVING',
  'DIRECT_READY', 'PROMPT_RENDERED', 'LLM_PENDING', 'GENERATED',
  'DISPLAY_READY', 'DISPLAYED', 'HIDDEN', 'DISCARDED', 'FAILED',
]);

export const TraceFinalStateSchema = z.enum([
  'FILTERED', 'DISCARDED', 'FAILED', 'HIDDEN',
]);

export const SemanticTypeV1Schema = z.enum([
  'persona_relevant', 'positive_praise', 'funny_joke',
  'interactive_question', 'atmosphere_boost', 'low_value', 'filter_risk',
]);

export const AuditContentTypeV1Schema = z.enum([
  'RAW_EVENT_JSON', 'NORMALIZED_COMMENT_JSON', 'DECISION_JSON',
  'PERSONA_TEXT', 'PROMPT_TEXT', 'PROVIDER_META_JSON',
  'PROVIDER_RESPONSE_JSON', 'SUGGESTION_JSON',
  'OVERLAY_RESULT_JSON', 'FINAL_REASON_JSON',
]);

export const AuditSnapshotRoleV1Schema = z.enum([
  'RAW_WS_EVENT', 'NORMALIZED_COMMENT', 'FILTER_DECISION',
  'INPUT_SAFETY_DECISION', 'PERSONA_ROUTE', 'PERSONA_VERSION_SNAPSHOT',
  'GOLDEN_QUERY_RESULT', 'PRE_QUERY_RESULT', 'RERANK_DECISION',
  'RENDERED_PROMPT', 'LLM_REQUEST_META', 'LLM_RAW_RESPONSE',
  'LLM_PARSED_OUTPUT', 'OUTPUT_VALIDATION', 'OUTPUT_SAFETY_DECISION',
  'DIRECT_PAYLOAD', 'DIRECT_DECISION', 'OVERLAY_RESULT', 'FINAL_REASON',
]);

export const ServiceLifecycleSchema = z.enum(['STOPPED', 'GATE_CONNECTING', 'RUNNING']);
export const ServiceActivitySchema = z.enum([
  'IDLE', 'GATE_CHECKING', 'LISTENING', 'RETRIEVING', 'GENERATING', 'DISPLAYING',
]);

// Fixed Bm25 zh pipeline identity (CONTRACT §4). Write and query share the same
// tokenizer/normalization; changing either requires a new profile/collection.
export const BM25_TOKENIZER_VERSION_V1 = 'zh_jieba_search_v1';
export const BM25_NORMALIZATION_VERSION_V1 = 'zh_bm25_normalize_v1';
export const BM25_VECTOR_NAME_V1 = 'bm25_zh_jieba_v1';

// Frozen Bm25 profile (CONTRACT §4.5 / DATA §7.2 in 09-design); changed params
// require a new profile + collection + atomic alias switch, never an in-place edit.
export const Bm25ZhJiebaProfileV1Schema = z.strictObject({
  profileId: z.string().min(1).max(64),
  tokenizerVersion: z.literal(BM25_TOKENIZER_VERSION_V1),
  normalizationVersion: z.literal(BM25_NORMALIZATION_VERSION_V1),
  preSetSha256: z.string().regex(/^[0-9a-f]{64}$/),
  avgDocLenBaseline: z.number().positive(),
  k1: z.number().positive(),
  b: z.number().min(0).max(1),
  qdrantVersion: z.string().min(1).max(32),
  calibrationArtifactId: z.string().min(1).max(128),
});

// Qdrant payload dictionaries (DATA §6.2). pre_set is read-only at runtime;
// golden_set is written only by the audit outbox with an idempotency key.
export const PreSetPayloadV1Schema = z.strictObject({
  schema_version: z.literal('1.0'),
  case_id: z.string().min(1).max(68),
  tokenizer_version: z.literal(BM25_TOKENIZER_VERSION_V1),
  text: z.string().min(1).max(200),
  semantic_type: SemanticTypeV1Schema,
  description: z.string().min(1).max(500),
  reference_reply: z.string().min(1).max(80).optional(),
  reference_cues: z.array(z.string().min(1).max(40)).min(1).max(3).optional(),
  tags: z.array(z.string().min(1).max(24)).max(10).optional(),
  enabled: z.boolean(),
  is_bad_case: z.boolean(),
});

export const GoldenSetPayloadV1Schema = z.strictObject({
  case_id: z.string().min(1).max(68),
  tokenizer_version: z.literal(BM25_TOKENIZER_VERSION_V1),
  source_trace_id: uuidV7,
  persona_id: z.string().min(1).max(64),
  persona_version: uuidV7,
  text: z.string().min(1).max(200),
  semantic_type: SemanticTypeV1Schema,
  reply: z.string().min(1).max(80),
  cues: z.array(z.string().min(1).max(40)).min(2).max(3),
  quality_score: z.number().int().min(0).max(100),
  enabled: z.boolean(),
  is_bad_case: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// Calibrated retrieval hit (CONTRACT §4.4). payload union discriminates on
// required fields; shapes are enforced at insert time by the payload schemas.
export const SourceCollectionV1Schema = z.enum(['pre_set', 'golden_set']);

export const RetrievalHitV1Schema = z.strictObject({
  pointId: z.string().min(1).max(68),
  caseId: z.string().min(1).max(68),
  collection: SourceCollectionV1Schema,
  rawScore: z.number().finite(),
  retrievalConfidence: z.number().min(0).max(1),
  rank: z.number().int().min(1),
  payload: z.union([PreSetPayloadV1Schema, GoldenSetPayloadV1Schema]),
});

export const RetrievalResultV1Schema = z.strictObject({
  traceId: uuidV7,
  calibrationVersion: z.string().min(1).max(64),
  goldenHits: z.array(RetrievalHitV1Schema),
  preHits: z.array(RetrievalHitV1Schema),
  mergedTopK: z.array(RetrievalHitV1Schema),
  directPushEligible: z.boolean(),
  directPointId: z.string().min(1).max(68).optional(),
});

// pre_set whole-package import (PRESET §7): the error-code union is the single
// authority shared by the main-process importer and the IPC result schema.
export const PreSetImportErrorCodeV1Schema = z.enum([
  'PRE_SET_UTF8_BOM',
  'PRE_SET_ENCODING',
  'PRE_SET_OVER_SIZE',
  'PRE_SET_OVER_ROWS',
  'PRE_SET_EMPTY',
  'PRE_SET_JSON',
  'PRE_SET_SCHEMA',
  'PRE_SET_DUPLICATE_ID',
  'PRE_SET_UNSAFE_CONTENT',
]);

// Line-scoped validation error (no case text crosses IPC; only line/id/path).
export const PreSetImportErrorV1Schema = z.strictObject({
  line: z.number().int().nonnegative(),
  id: z.string().min(1).max(68).optional(),
  path: z.string().min(1).max(128).optional(),
  errorCode: PreSetImportErrorCodeV1Schema,
});

export const PreSetImportRequestV1Schema = z.strictObject({
  content: z.string(),
});

// Import is all-or-nothing: ok:false carries a bounded error list (truncated
// marks that only the first errors were returned). ok:true reuses the frozen
// Bm25 profile that bootstrap computed and atomically published.
export const PreSetImportResultV1Schema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    profile: Bm25ZhJiebaProfileV1Schema,
    entryCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(false),
    errors: z.array(PreSetImportErrorV1Schema),
    truncated: z.boolean().optional(),
  }),
]);

// Run-page retrieval readiness (RUNBOOK §3.1 step 5): qdrantHealthy reflects the
// sidecar, ready reflects whether the pre_set alias is published. profileId/
// preSetSha256 are anonymous profile facts, not case data.
export const RetrievalInitStatusV1Schema = z.strictObject({
  qdrantHealthy: z.boolean(),
  ready: z.boolean(),
  profileId: z.string().min(1).max(64).optional(),
  preSetSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  error: z.string().min(1).max(64).optional(),
});

// Diagnostic visibility of the two local collections (UI §8.1): anonymous point
// counts only, so the host can confirm backflow into golden_set without exposing
// any case payload. 0 means the collection is absent or empty, never an error.
// Sanctioned T-SCOPE-001 exception: the golden key is allowed here by design
// (the retrieval.getCollectionCounts channel is in the sanctioned allowlist).
export const CollectionCountsV1Schema = z.strictObject({
  preSetPointCount: z.number().int().nonnegative(),
  goldenSetPointCount: z.number().int().nonnegative(),
});

export const SafetyReasonCodeV1Schema = z.enum([
  'ABUSE', 'PII', 'POLITICS', 'SEXUAL', 'ILLEGAL',
  'MEDICAL_FINANCIAL_ADVICE', 'COMPETITOR', 'TRANSACTION_PRICE',
  'TEAM_FORBIDDEN', 'SAFETY_ENGINE_ERROR',
]);

export const TraceReasonCodeV1Schema = z.enum([
  'EVENT_RECEIVED', 'NORMALIZATION_OK', 'INPUT_SAFETY_FILTERED',
  'PERSONA_ROUTED', 'RETRIEVAL_STARTED', 'GOLDEN_DIRECT_ELIGIBLE',
  'LLM_REQUIRED', 'PROVIDER_REQUESTED',
  'PROVIDER_SUCCEEDED', 'PROVIDER_FAILED', 'OUTPUT_VALIDATED',
  'OUTPUT_INVALID', 'OVERLAY_RENDERED', 'DISPLAY_DURATION_ELAPSED',
  'DISPLAY_WINDOW_ACTIVE', 'LOW_VALUE', 'PERSONA_REVIEW_UNCERTAIN',
  'STALE_SESSION', 'STALE_WINDOW', 'DEADLINE_EXCEEDED',
  'AUDIT_FAILURE', 'SOURCE_ERROR', 'ROOM_ENDED', 'USER_STOPPED',
]);

export const OutboxJobStateV1Schema = z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']);
export const OutboxActionV1Schema = z.enum(['UPSERT', 'SET_BAD_CASE']);

export const SERVICE_LIFECYCLE_TRANSITIONS_V1 = {
  STOPPED: ['GATE_CONNECTING'],
  GATE_CONNECTING: ['RUNNING', 'STOPPED'],
  RUNNING: ['STOPPED'],
} as const;

export const TRACE_TRANSITIONS_V1 = {
  INITIAL: ['RECEIVED'],
  RECEIVED: ['NORMALIZED'],
  NORMALIZED: ['FILTERED', 'ROUTED', 'DISCARDED'],
  FILTERED: [],
  ROUTED: ['RETRIEVING'],
  RETRIEVING: ['DIRECT_READY', 'PROMPT_RENDERED', 'DISCARDED'],
  DIRECT_READY: ['DISPLAY_READY'],
  PROMPT_RENDERED: ['LLM_PENDING'],
  LLM_PENDING: ['GENERATED', 'FAILED', 'DISCARDED'],
  GENERATED: ['DISPLAY_READY', 'DISCARDED'],
  DISPLAY_READY: ['DISPLAYED', 'DISCARDED'],
  DISPLAYED: ['HIDDEN'],
  HIDDEN: [],
  DISCARDED: [],
  FAILED: [],
} as const;

export const OUTBOX_TRANSITIONS_V1 = {
  PENDING: ['RUNNING'],
  RUNNING: ['SUCCEEDED', 'FAILED'],
  FAILED: ['PENDING'],
  SUCCEEDED: [],
} as const;

export const ProviderErrorV1Schema = z.enum([
  'AUTH', 'BILLING', 'VALIDATION', 'RATE_LIMIT', 'NETWORK',
  'SERVER', 'TIMEOUT', 'ABORTED', 'PROTOCOL', 'OUTPUT_INVALID',
]);

export const DomainErrorV1Schema = z.enum([
  'E_CONFIG_INVALID', 'E_AUDIT_UNAVAILABLE', 'E_AUDIT_STATE_INVALID',
  'E_QDRANT_UNAVAILABLE', 'E_SIDECAR_START_FAILED', 'E_SOURCE_UNAVAILABLE',
  'E_ROOM_OFFLINE', 'E_ROOM_ENDED', 'E_SAFETY_POLICY_INVALID',
  'E_PROVIDER_AUTH', 'E_PROVIDER_BILLING', 'E_PROVIDER_RATE_LIMIT',
  'E_PROVIDER_NETWORK', 'E_PROVIDER_SERVER', 'E_PROVIDER_TIMEOUT',
  'E_PROVIDER_PROTOCOL', 'E_PROVIDER_OUTPUT_INVALID',
  'E_GOLDEN_SYNC_FAILED', 'E_STORAGE_LOW',
]);

export const ProviderConfigV1Schema = z.strictObject({
  providerId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(80),
  adapterType: z.enum(['DEEPSEEK', 'OPENAI_COMPATIBLE', 'ANTHROPIC_MESSAGES']),
  baseUrl: z.string().url().superRefine((value, ctx) => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      ctx.addIssue({ code: 'custom', message: 'Base URL must be HTTPS without userinfo, query, or fragment' });
    }
  }),
  modelId: z.string().min(1).max(128),
  credentialRef: z.string().min(1).max(128),
});

export const ConnectionTestResultV1Schema = z.strictObject({
  status: z.enum(['OK', 'AUTH_FAILED', 'UNAVAILABLE']),
});

// Machine-readable shape of provider-contract-fixtures-v1.json (CONTRACT §6).
export const ProviderFixtureResponseV1Schema = z.strictObject({
  status: z.number().int().positive().optional(),
  body: z.unknown().optional(),
  abortAtMs: z.number().int().positive().optional(),
});

export const ProviderFixtureExpectedV1Schema = z.strictObject({
  ok: z.boolean(),
  quick_reply: z.string().optional(),
  cues: z.array(z.string()).optional(),
  providerError: ProviderErrorV1Schema.optional(),
  domainError: DomainErrorV1Schema.optional(),
  retry: z.boolean().optional(),
});

export const ProviderFixtureCaseV1Schema = z.strictObject({
  id: z.string().min(1),
  adapterType: z.enum(['DEEPSEEK', 'OPENAI_COMPATIBLE']).optional(),
  config: ProviderConfigV1Schema.optional(),
  request: z.unknown().optional(),
  response: ProviderFixtureResponseV1Schema.optional(),
  expected: ProviderFixtureExpectedV1Schema,
});

export const OverlayPreferenceV1Schema = z.strictObject({
  durationMs: z.number().int().min(1000).max(60000),
  width: z.number().int().min(320).max(1920),
  height: z.number().int().min(120).max(1080),
  opacity: z.number().min(0.2).max(1),
  fontScale: z.number().min(0.75).max(2),
  theme: z.enum(['light', 'dark']),
  clickThrough: z.boolean(),
});

// TD-08: user-configured system prompt override for the LLM reply generation.
// Absent means the runtime uses the code-default template; the immutable hard
// rules are always appended by the PromptAssembler regardless of the template.
export const SystemPromptV1Schema = z.strictObject({
  systemPromptTemplate: z.string().trim().min(1).max(20000),
  templateVersion: z.string().trim().min(1).max(64),
  updatedAt: z.string().datetime({ offset: true }),
});

export const SettingsV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  roomReference: z.string().min(1).max(128).optional(),
  provider: ProviderConfigV1Schema.optional(),
  activeSafetyPolicyVersion: uuidV7.optional(),
  overlay: OverlayPreferenceV1Schema,
  prompt: SystemPromptV1Schema.optional(),
  internalRetrieval: z.strictObject({
    calibrationVersion: z.string().min(1).max(64),
    directPushThreshold: z.number().min(0).max(1),
    windowMaxAgeMs: z.number().int().min(100).max(30000),
    candidateMaxCount: z.number().int().min(1).max(1000),
  }),
});

// Renderer-facing config view (UI §7.1): internalRetrieval never crosses IPC,
// the API key surfaces only as a boolean, never its value.
export const ConfigViewV1Schema = z.strictObject({
  roomReference: z.string().min(1).max(128).optional(),
  provider: ProviderConfigV1Schema.optional(),
  activeSafetyPolicyVersion: uuidV7.optional(),
  overlay: OverlayPreferenceV1Schema,
  prompt: SystemPromptV1Schema.optional(),
  apiKeyConfigured: z.boolean(),
});

// Provider fields a user submits; providerId/credentialRef are derived by the
// handler. ANTHROPIC_MESSAGES has no adapter (M5-04), so it is not offerable.
export const ProviderConfigInputV1Schema = z.strictObject({
  displayName: z.string().min(1).max(80),
  adapterType: z.enum(['DEEPSEEK', 'OPENAI_COMPATIBLE']),
  baseUrl: z.string().url().superRefine((value, ctx) => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      ctx.addIssue({ code: 'custom', message: 'Base URL must be HTTPS without userinfo, query, or fragment' });
    }
  }),
  modelId: z.string().min(1).max(128),
});

export const ConfigUpdateRequestV1Schema = z.strictObject({
  roomReference: z.string().min(1).max(128).optional(),
  provider: ProviderConfigInputV1Schema.optional(),
  // TD-08: empty string clears the custom template back to the code default.
  systemPrompt: z.string().trim().max(20000).optional(),
}).superRefine((value, ctx) => {
  if (
    value.roomReference === undefined &&
    value.provider === undefined &&
    value.systemPrompt === undefined
  ) {
    ctx.addIssue({ code: 'custom', message: 'at least one of roomReference, provider, or systemPrompt is required' });
  }
});

// Persona summary for list views (M6-02 run page, M6-04 persona page). Mirrors
// PersonaStore.PersonaSummary without internal fields.
export const PersonaSummaryV1Schema = z.strictObject({
  personaId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(80),
  isPrincipal: z.boolean(),
  activeVersion: z.string().min(1).max(128).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  aliasCount: z.number().int().min(0),
  versionCount: z.number().int().min(0),
});

export const AliasKindV1Schema = z.enum(['NAME', 'NICKNAME', 'ALIAS', 'TYPO_VARIANT']);

export const AliasInputV1Schema = z.strictObject({
  aliasText: z.string().trim().min(1).max(64),
  aliasKind: AliasKindV1Schema,
  enabled: z.boolean().optional(),
});

export const AliasRowV1Schema = z.strictObject({
  aliasId: z.string().min(1).max(64),
  personaId: z.string().min(1).max(64),
  aliasText: z.string().min(1).max(64),
  aliasKind: AliasKindV1Schema,
  enabled: z.boolean(),
});

export const PersonaVersionMetaV1Schema = z.strictObject({
  personaVersion: z.string().min(1).max(128),
  personaId: z.string().min(1).max(64),
  status: z.enum(['DRAFT', 'PUBLISHED', 'SUPERSEDED']),
  contentHmac: z.string().min(1).max(128),
  createdAt: z.string().datetime({ offset: true }),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
  createdFromVersion: z.string().min(1).max(128).nullable(),
});

export const VersionComparisonV1Schema = z.strictObject({
  a: PersonaVersionMetaV1Schema,
  b: PersonaVersionMetaV1Schema,
  sameContent: z.boolean(),
});

export const PersonaDetailV1Schema = z.strictObject({
  summary: PersonaSummaryV1Schema,
  aliases: z.array(AliasRowV1Schema),
  versions: z.array(PersonaVersionMetaV1Schema),
  // Decrypted persona content for the authorized editing page: the latest draft,
  // else the active published version, else empty.
  editableContent: z.string().max(50000),
});

export const PersonaGetRequestV1Schema = z.strictObject({ personaId: z.string().min(1).max(64) });
export const PersonaDeleteRequestV1Schema = z.strictObject({ personaId: z.string().min(1).max(64) });
export const PersonaSetPrincipalRequestV1Schema = z.strictObject({ personaId: z.string().min(1).max(64) });

export const PersonaCreateRequestV1Schema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
  aliases: z.array(AliasInputV1Schema).max(50).optional(),
});

export const PersonaSaveDraftRequestV1Schema = z.strictObject({
  personaId: z.string().min(1).max(64),
  content: z.string().max(50000).optional(),
  fromVersion: z.string().min(1).max(128).optional(),
}).superRefine((value, ctx) => {
  if (value.content === undefined && value.fromVersion === undefined) {
    ctx.addIssue({ code: 'custom', message: 'content or fromVersion is required' });
  }
});

export const PersonaPublishRequestV1Schema = z.strictObject({ personaVersion: z.string().min(1).max(128) });
export const PersonaListVersionsRequestV1Schema = z.strictObject({ personaId: z.string().min(1).max(64) });
export const PersonaCompareRequestV1Schema = z.strictObject({
  a: z.string().min(1).max(128),
  b: z.string().min(1).max(128),
});

// TD-07: fetch one version's decrypted full content for the view mode.
// personaId is required so a version id alone cannot read another member.
export const PersonaGetVersionContentRequestV1Schema = z.strictObject({
  personaId: z.string().min(1).max(64),
  personaVersion: z.string().min(1).max(128),
});

export const PersonaVersionContentV1Schema = z.strictObject({
  personaVersion: z.string().min(1).max(128),
  content: z.string().max(50000),
});

export const PersonaUpdateAliasesRequestV1Schema = z.strictObject({
  personaId: z.string().min(1).max(64),
  aliases: z.array(AliasInputV1Schema).max(50),
});

// Safety policy view for the authorized settings page (UI §7.2). `current` is
// the editable content (latest draft else the active published version);
// compiled rules never cross this boundary.
export const CompileErrorV1Schema = z.strictObject({
  clauseIndex: z.number().int().min(-1),
  message: z.string().min(1),
});

export const SafetyPolicyVersionMetaV1Schema = z.strictObject({
  safetyPolicyVersion: z.string().min(1).max(128),
  status: z.enum(['DRAFT', 'PUBLISHED', 'SUPERSEDED', 'INVALID']),
  compilerVersion: z.string().min(1).max(64),
  createdAt: z.string().datetime({ offset: true }),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
});

export const SafetyPolicyCurrentV1Schema = z.strictObject({
  versionId: z.string().min(1).max(128),
  policyText: z.string().max(50000),
  keywords: z.array(z.string().trim().min(1).max(64)).max(50),
  validationErrors: z.array(CompileErrorV1Schema),
});

export const SafetyPolicyViewV1Schema = z.strictObject({
  activeVersion: SafetyPolicyVersionMetaV1Schema.nullable(),
  current: SafetyPolicyCurrentV1Schema.nullable(),
  versions: z.array(SafetyPolicyVersionMetaV1Schema),
});

export const SafetySaveDraftRequestV1Schema = z.strictObject({
  policyText: z.string().max(50000),
  keywords: z.array(z.string().trim().min(1).max(64)).max(50),
});

export const SafetyPublishRequestV1Schema = z.strictObject({
  safetyPolicyVersion: z.string().min(1).max(128),
});

export const SafetySaveDraftResultV1Schema = z.strictObject({
  versionMeta: SafetyPolicyVersionMetaV1Schema,
  valid: z.boolean(),
  errors: z.array(CompileErrorV1Schema),
});

// Anonymous run summary for the diagnostics source (UI §8.1); no comment text,
// persona text, keys, or trace ids cross this boundary.
export const DiagnosticSummaryV1Schema = z.strictObject({
  lifecycle: ServiceLifecycleSchema,
  activity: ServiceActivitySchema,
  lastCommentReceivedAt: z.string().datetime({ offset: true }).optional(),
  lastSuggestionAt: z.string().datetime({ offset: true }).optional(),
  lastSuggestionResult: z.enum(['displayed', 'filtered', 'discarded', 'failed']).optional(),
  lastE2eLatencyMs: z.number().nonnegative().optional(),
  lastDomainError: DomainErrorV1Schema.optional(),
  storageAvailableBytes: z.number().nonnegative().int().optional(),
  storageLowSpace: z.boolean().optional(),
});

export const ServiceViewStateSchema = z.strictObject({
  lifecycle: ServiceLifecycleSchema,
  activity: ServiceActivitySchema,
  stopReason: z.enum([
    'USER_STOP', 'ROOM_OFFLINE', 'ROOM_ENDED', 'SOURCE_ERROR', 'AUDIT_UNAVAILABLE',
  ]).optional(),
  recoverableError: z.strictObject({
    code: DomainErrorV1Schema,
    at: z.string().datetime({ offset: true }),
  }).optional(),
});

// Live source event (CONTRACT §5). Produced by the douyinLive WS adapter;
// gift/like frames never become COMMENT events.
export const SourceCommentSchema = z.strictObject({
  sourceMessageId: z.string().min(1).max(68),
  platformRoomId: z.string().min(1).max(68).optional(),
  rawEvent: z.unknown(),
  rawText: z.string().max(2000),
  normalizedText: z.string().max(2000),
  userNickname: z.string().max(64).optional(),
  upstreamCreatedAt: z.string().max(64).optional(),
  receivedAt: z.string().datetime({ offset: true }),
  receivedMonotonicMs: z.number().nonnegative().finite(),
});

export const LiveSourceEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('LIVE_ONLINE'),
    roomReference: z.string().min(1).max(128),
    platformRoomId: z.string().min(1).max(68).optional(),
    receivedAt: z.string().datetime({ offset: true }),
  }),
  z.strictObject({
    type: z.literal('LIVE_OFFLINE'),
    roomReference: z.string().min(1).max(128),
    receivedAt: z.string().datetime({ offset: true }),
  }),
  z.strictObject({
    type: z.literal('LIVE_ENDED'),
    roomReference: z.string().min(1).max(128),
    receivedAt: z.string().datetime({ offset: true }),
  }),
  z.strictObject({
    type: z.literal('COMMENT'),
    comment: SourceCommentSchema,
  }),
  z.strictObject({
    type: z.literal('SOURCE_ERROR'),
    code: DomainErrorV1Schema,
    message: z.string().max(512),
    receivedAt: z.string().datetime({ offset: true }),
  }),
]);

export const SuggestionOutputV1Schema = z.strictObject({
  quick_reply: z.string().trim().min(1).max(80),
  cues: z.array(z.string().trim().min(1).max(40)).min(2).max(3),
});

// Shared output validator reason codes (LLM §5.2). Mirrors TraceReasonCodeV1's
// role as a contract-level enum; referenced by OUTPUT_VALIDATION snapshots.
export const OutputValidationReasonV1Schema = z.enum([
  'JSON_PARSE_FAILED', 'JSON_SCHEMA_FAILED', 'UNSAFE_CONTROL_CHAR',
  'EMPTY_QUICK_REPLY', 'QUICK_REPLY_TOO_LONG',
  'CUE_COUNT_INVALID', 'CUE_EMPTY', 'CUE_TOO_LONG', 'CUE_DUPLICATE',
  'RISK_RULE_HIT', 'PERSONAL_INFO_HIT', 'FORBIDDEN_POLICY_HIT',
  'PERSONA_REVIEW_UNCERTAIN',
]);

export const SuggestionSourceV1Schema = z.enum(['llm', 'retrieval_payload']);

// Cross-process display shape (M6-07 overlay renders this over IPC), distinct
// from the provider wire shape SuggestionOutputV1Schema (snake_case). Length is
// owned by the shared output validator's han-count (LLM §5.1), never by JSON
// Schema maxLength, so only min constraints live here.
export const ValidatedSuggestionV1Schema = z.strictObject({
  quickReply: z.string().min(1),
  cues: z.array(z.string().min(1)).min(2).max(3),
  source: SuggestionSourceV1Schema,
});

// Overlay display content (UI §5): the suggestion plus the triggering comment
// (@nickname hidden when absent). The sink passes this over overlay.renderSuggestion;
// trace_id never crosses to the overlay renderer — a requestId nonce matches the ack.
export const OverlayDisplayPayloadV1Schema = z.strictObject({
  comment: z.strictObject({
    nickname: z.string().min(1).max(64).optional(),
    text: z.string().min(1).max(2000),
    // Comment sent time as local "HH:mm:ss" (createTime, or receivedAt fallback).
    sentAt: z.string().min(1).max(64).optional(),
  }),
  suggestion: ValidatedSuggestionV1Schema,
});

export const OverlayDisplayRequestV1Schema = z.strictObject({
  requestId: z.string().min(1).max(64),
  payload: OverlayDisplayPayloadV1Schema,
});

export const OverlayAckRequestV1Schema = z.strictObject({
  requestId: z.string().min(1).max(64),
});

// CONTRACT §7: audit.search filters by time range (from/to), final result
// (finalState, UI §8.2 结果筛选), user-visible labelStatus, and pagination.
// pageSize is clamped to 1-100 and rows default to received_at DESC.
export const AuditSearchRequestV1Schema = z.strictObject({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  finalState: TraceFinalStateSchema.optional(),
  labelStatus: LabelStatusSchema.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const AuditGetWorkflowRequestV1Schema = z.strictObject({ traceId: uuidV7 });

// M6-09: one paginated audit-list row (UI §8.2). commentText is decrypted
// on demand from the trace's NORMALIZED_COMMENT snapshot; it never reaches the
// overlay, only the authorized main-window audit page.
export const AuditTraceSummaryV1Schema = z.strictObject({
  traceId: z.string().min(1).max(64),
  receivedAt: z.string().datetime({ offset: true }),
  finalState: TraceFinalStateSchema.nullable(),
  labelStatus: LabelStatusSchema,
  hasSuggestion: z.boolean(),
  commentText: z.string().max(2000),
  // Existing feedback revision count; the label form uses it as the optimistic
  // lock baseline (expectedRevisionNo) so edits keep succeeding after re-save.
  revisionCount: z.number().int().nonnegative(),
});

export const AuditSearchResponseV1Schema = z.strictObject({
  items: z.array(AuditTraceSummaryV1Schema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
});

// M6-09: serializable workflow context (Buffer plaintext → utf-8 string).
export const AuditWorkflowSnapshotV1Schema = z.strictObject({
  snapshotId: z.string().min(1),
  role: AuditSnapshotRoleV1Schema,
  contentType: AuditContentTypeV1Schema,
  plaintext: z.string(),
});

export const AuditWorkflowTransitionV1Schema = z.strictObject({
  sequenceNo: z.number().int().nonnegative(),
  fromState: TraceStateSchema.nullable(),
  toState: TraceStateSchema,
  reasonCode: TraceReasonCodeV1Schema,
  occurredAt: z.string().datetime({ offset: true }),
  snapshots: z.array(AuditWorkflowSnapshotV1Schema),
});

export const AuditWorkflowV1Schema = z.strictObject({
  traceId: z.string().min(1).max(64),
  transitions: z.array(AuditWorkflowTransitionV1Schema),
});

export const AuditSubmitLabelRequestV1Schema = z.strictObject({
  traceId: uuidV7,
  // Optimistic lock (DATA §4.3 修订而非覆盖): the revision count the caller
  // observed; a concurrent edit bumps it and the write is rejected.
  expectedRevisionNo: z.number().int().min(0),
  score: z.number().int().min(0).max(100),
  correctedQuickReply: z.string().trim().min(1).max(80).optional(),
  correctedCues: z.array(z.string().trim().min(1).max(40)).min(2).max(3).optional(),
}).superRefine((value, ctx) => {
  const hasReply = value.correctedQuickReply !== undefined;
  const hasCues = value.correctedCues !== undefined;
  if (hasReply !== hasCues) {
    ctx.addIssue({ code: 'custom', message: 'corrected reply and cues must be submitted together' });
  }
});

// CONTRACT §7: audit.submitLabel returns only the user-visible labelStatus.
export const AuditSubmitLabelResponseV1Schema = z.strictObject({
  labelStatus: LabelStatusSchema,
});

export type ProviderConfigV1 = z.infer<typeof ProviderConfigV1Schema>;
export type ConfigViewV1 = z.infer<typeof ConfigViewV1Schema>;
export type ProviderConfigInputV1 = z.infer<typeof ProviderConfigInputV1Schema>;
export type ConfigUpdateRequestV1 = z.infer<typeof ConfigUpdateRequestV1Schema>;
export type PersonaSummaryV1 = z.infer<typeof PersonaSummaryV1Schema>;
export type AliasKindV1 = z.infer<typeof AliasKindV1Schema>;
export type AliasInputV1 = z.infer<typeof AliasInputV1Schema>;
export type AliasRowV1 = z.infer<typeof AliasRowV1Schema>;
export type PersonaVersionMetaV1 = z.infer<typeof PersonaVersionMetaV1Schema>;
export type PersonaGetVersionContentRequestV1 = z.infer<typeof PersonaGetVersionContentRequestV1Schema>;
export type PersonaVersionContentV1 = z.infer<typeof PersonaVersionContentV1Schema>;
export type VersionComparisonV1 = z.infer<typeof VersionComparisonV1Schema>;
export type PersonaDetailV1 = z.infer<typeof PersonaDetailV1Schema>;
export type PersonaCreateRequestV1 = z.infer<typeof PersonaCreateRequestV1Schema>;
export type PersonaSaveDraftRequestV1 = z.infer<typeof PersonaSaveDraftRequestV1Schema>;
export type PersonaPublishRequestV1 = z.infer<typeof PersonaPublishRequestV1Schema>;
export type PersonaUpdateAliasesRequestV1 = z.infer<typeof PersonaUpdateAliasesRequestV1Schema>;
export type CompileErrorV1 = z.infer<typeof CompileErrorV1Schema>;
export type SafetyPolicyVersionMetaV1 = z.infer<typeof SafetyPolicyVersionMetaV1Schema>;
export type SafetyPolicyCurrentV1 = z.infer<typeof SafetyPolicyCurrentV1Schema>;
export type SafetyPolicyViewV1 = z.infer<typeof SafetyPolicyViewV1Schema>;
export type SafetySaveDraftRequestV1 = z.infer<typeof SafetySaveDraftRequestV1Schema>;
export type SafetyPublishRequestV1 = z.infer<typeof SafetyPublishRequestV1Schema>;
export type SafetySaveDraftResultV1 = z.infer<typeof SafetySaveDraftResultV1Schema>;
export type DiagnosticSummaryV1 = z.infer<typeof DiagnosticSummaryV1Schema>;
export type ConnectionTestResultV1 = z.infer<typeof ConnectionTestResultV1Schema>;
export type ProviderFixtureResponseV1 = z.infer<typeof ProviderFixtureResponseV1Schema>;
export type ProviderFixtureExpectedV1 = z.infer<typeof ProviderFixtureExpectedV1Schema>;
export type ProviderFixtureCaseV1 = z.infer<typeof ProviderFixtureCaseV1Schema>;
export type OverlayPreferenceV1 = z.infer<typeof OverlayPreferenceV1Schema>;
export type SystemPromptV1 = z.infer<typeof SystemPromptV1Schema>;
export type SettingsV1 = z.infer<typeof SettingsV1Schema>;
export type ServiceViewState = z.infer<typeof ServiceViewStateSchema>;
export type SuggestionOutputV1 = z.infer<typeof SuggestionOutputV1Schema>;
export type OutputValidationReasonV1 = z.infer<typeof OutputValidationReasonV1Schema>;
export type SuggestionSourceV1 = z.infer<typeof SuggestionSourceV1Schema>;
export type ValidatedSuggestionV1 = z.infer<typeof ValidatedSuggestionV1Schema>;
export type OverlayDisplayPayloadV1 = z.infer<typeof OverlayDisplayPayloadV1Schema>;
export type OverlayDisplayRequestV1 = z.infer<typeof OverlayDisplayRequestV1Schema>;
export type OverlayAckRequestV1 = z.infer<typeof OverlayAckRequestV1Schema>;
export type LabelStatus = z.infer<typeof LabelStatusSchema>;
export type TraceState = z.infer<typeof TraceStateSchema>;
export type TraceFinalState = z.infer<typeof TraceFinalStateSchema>;
export type SemanticTypeV1 = z.infer<typeof SemanticTypeV1Schema>;
export type AuditContentTypeV1 = z.infer<typeof AuditContentTypeV1Schema>;
export type AuditSnapshotRoleV1 = z.infer<typeof AuditSnapshotRoleV1Schema>;
export type ServiceLifecycle = z.infer<typeof ServiceLifecycleSchema>;
export type ServiceActivity = z.infer<typeof ServiceActivitySchema>;
export type SafetyReasonCodeV1 = z.infer<typeof SafetyReasonCodeV1Schema>;
export type TraceReasonCodeV1 = z.infer<typeof TraceReasonCodeV1Schema>;
export type ProviderErrorV1 = z.infer<typeof ProviderErrorV1Schema>;
export type DomainErrorV1 = z.infer<typeof DomainErrorV1Schema>;
export type OutboxJobStateV1 = z.infer<typeof OutboxJobStateV1Schema>;
export type OutboxActionV1 = z.infer<typeof OutboxActionV1Schema>;
export type AuditSearchRequestV1 = z.infer<typeof AuditSearchRequestV1Schema>;
export type AuditGetWorkflowRequestV1 = z.infer<typeof AuditGetWorkflowRequestV1Schema>;
export type AuditTraceSummaryV1 = z.infer<typeof AuditTraceSummaryV1Schema>;
export type AuditSearchResponseV1 = z.infer<typeof AuditSearchResponseV1Schema>;
export type AuditWorkflowV1 = z.infer<typeof AuditWorkflowV1Schema>;
export type AuditWorkflowTransitionV1 = z.infer<typeof AuditWorkflowTransitionV1Schema>;
export type AuditWorkflowSnapshotV1 = z.infer<typeof AuditWorkflowSnapshotV1Schema>;
export type AuditSubmitLabelRequestV1 = z.infer<typeof AuditSubmitLabelRequestV1Schema>;
export type AuditSubmitLabelResponseV1 = z.infer<typeof AuditSubmitLabelResponseV1Schema>;
export type Bm25ZhJiebaProfileV1 = z.infer<typeof Bm25ZhJiebaProfileV1Schema>;
export type PreSetPayloadV1 = z.infer<typeof PreSetPayloadV1Schema>;
export type GoldenSetPayloadV1 = z.infer<typeof GoldenSetPayloadV1Schema>;
export type SourceCollectionV1 = z.infer<typeof SourceCollectionV1Schema>;
export type RetrievalHitV1 = z.infer<typeof RetrievalHitV1Schema>;
export type RetrievalResultV1 = z.infer<typeof RetrievalResultV1Schema>;
export type SourceComment = z.infer<typeof SourceCommentSchema>;
export type LiveSourceEvent = z.infer<typeof LiveSourceEventSchema>;
export type PreSetImportErrorCodeV1 = z.infer<typeof PreSetImportErrorCodeV1Schema>;
export type PreSetImportErrorV1 = z.infer<typeof PreSetImportErrorV1Schema>;
export type PreSetImportRequestV1 = z.infer<typeof PreSetImportRequestV1Schema>;
export type PreSetImportResultV1 = z.infer<typeof PreSetImportResultV1Schema>;
export type RetrievalInitStatusV1 = z.infer<typeof RetrievalInitStatusV1Schema>;
export type CollectionCountsV1 = z.infer<typeof CollectionCountsV1Schema>;
