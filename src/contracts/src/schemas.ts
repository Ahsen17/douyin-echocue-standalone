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

export const OverlayPreferenceV1Schema = z.strictObject({
  durationMs: z.number().int().min(1000).max(60000),
  width: z.number().int().min(320).max(1920),
  height: z.number().int().min(120).max(1080),
  opacity: z.number().min(0.2).max(1),
  fontScale: z.number().min(0.75).max(2),
  theme: z.enum(['light', 'dark']),
  clickThrough: z.boolean(),
});

export const SettingsV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  roomReference: z.string().min(1).max(128).optional(),
  provider: ProviderConfigV1Schema.optional(),
  activeSafetyPolicyVersion: uuidV7.optional(),
  overlay: OverlayPreferenceV1Schema,
  internalRetrieval: z.strictObject({
    calibrationVersion: z.string().min(1).max(64),
    directPushThreshold: z.number().min(0).max(1),
    windowMaxAgeMs: z.number().int().min(100).max(30000),
    candidateMaxCount: z.number().int().min(1).max(1000),
  }),
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

export const SuggestionOutputV1Schema = z.strictObject({
  quick_reply: z.string().trim().min(1).max(80),
  cues: z.array(z.string().trim().min(1).max(40)).min(2).max(3),
});

export const AuditSearchRequestV1Schema = z.strictObject({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  labelStatus: LabelStatusSchema.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const AuditGetWorkflowRequestV1Schema = z.strictObject({ traceId: uuidV7 });

export const AuditSubmitLabelRequestV1Schema = z.strictObject({
  traceId: uuidV7,
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

export type ProviderConfigV1 = z.infer<typeof ProviderConfigV1Schema>;
export type OverlayPreferenceV1 = z.infer<typeof OverlayPreferenceV1Schema>;
export type SettingsV1 = z.infer<typeof SettingsV1Schema>;
export type ServiceViewState = z.infer<typeof ServiceViewStateSchema>;
export type SuggestionOutputV1 = z.infer<typeof SuggestionOutputV1Schema>;
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
export type AuditSubmitLabelRequestV1 = z.infer<typeof AuditSubmitLabelRequestV1Schema>;
