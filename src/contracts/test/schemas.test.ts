/**
 * Echocue contract package test — runs directly with Node.js (no test framework).
 * Validates key schemas for normal, boundary, and failure paths.
 */
import { strict as assert } from 'assert';
import {
  SettingsV1Schema,
  ServiceViewStateSchema,
  ProviderConfigV1Schema,
  ConfigViewV1Schema,
  ConfigUpdateRequestV1Schema,
  ProviderConfigInputV1Schema,
  PersonaSummaryV1Schema,
  AliasInputV1Schema,
  AliasRowV1Schema,
  PersonaVersionMetaV1Schema,
  VersionComparisonV1Schema,
  PersonaDetailV1Schema,
  PersonaCreateRequestV1Schema,
  PersonaSaveDraftRequestV1Schema,
  PersonaUpdateAliasesRequestV1Schema,
  CompileErrorV1Schema,
  SafetyPolicyVersionMetaV1Schema,
  SafetyPolicyCurrentV1Schema,
  SafetyPolicyViewV1Schema,
  SafetySaveDraftRequestV1Schema,
  SafetyPublishRequestV1Schema,
  SafetySaveDraftResultV1Schema,
  DiagnosticSummaryV1Schema,
  ConnectionTestResultV1Schema,
  ProviderFixtureCaseV1Schema,
  ProviderFixtureResponseV1Schema,
  ProviderFixtureExpectedV1Schema,
  OverlayPreferenceV1Schema,
  SuggestionOutputV1Schema,
  OutputValidationReasonV1Schema,
  SuggestionSourceV1Schema,
  ValidatedSuggestionV1Schema,
  OverlayDisplayPayloadV1Schema,
  OverlayDisplayRequestV1Schema,
  OverlayAckRequestV1Schema,
  AuditSearchRequestV1Schema,
  AuditSubmitLabelRequestV1Schema,
  AuditGetWorkflowRequestV1Schema,
  TraceStateSchema,
  DomainErrorV1Schema,
  LiveSourceEventSchema,
  SourceCommentSchema,
  SERVICE_LIFECYCLE_TRANSITIONS_V1,
  TRACE_TRANSITIONS_V1,
  OUTBOX_TRANSITIONS_V1,
} from '../src/schemas.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

function expectValid<T>(schema: { parse: (v: unknown) => T }, value: unknown, label: string) {
  try {
    schema.parse(value);
  } catch (err) {
    throw new Error(`Expected valid for "${label}": ${(err as Error).message}`);
  }
}

function expectInvalid(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown, label: string) {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error(`Expected invalid for "${label}" but schema accepted it`);
  }
}

const VALID_OVERLAY: object = {
  durationMs: 5000,
  width: 800,
  height: 200,
  opacity: 0.9,
  fontScale: 1,
  theme: 'dark',
  clickThrough: false,
};

const VALID_SETTINGS: object = {
  schemaVersion: 1,
  overlay: VALID_OVERLAY,
  internalRetrieval: {
    calibrationVersion: 'v1',
    directPushThreshold: 0.85,
    windowMaxAgeMs: 5000,
    candidateMaxCount: 10,
  },
};

const VALID_PROVIDER: object = {
  providerId: 'deepseek-01',
  displayName: 'DeepSeek',
  adapterType: 'DEEPSEEK',
  baseUrl: 'https://api.deepseek.com',
  modelId: 'deepseek-chat',
  credentialRef: 'deepseek-01-key',
};

// SettingsV1
console.log('\nSettingsV1Schema');
test('valid minimal settings', () => expectValid(SettingsV1Schema, VALID_SETTINGS, 'minimal'));
test('valid settings with provider', () => expectValid(SettingsV1Schema, { ...VALID_SETTINGS, provider: VALID_PROVIDER }, 'with provider'));
test('rejects wrong schemaVersion', () => expectInvalid(SettingsV1Schema, { ...VALID_SETTINGS, schemaVersion: 2 }, 'schemaVersion 2'));
test('rejects extra field', () => expectInvalid(SettingsV1Schema, { ...VALID_SETTINGS, extra: true }, 'extra field'));

// ConfigViewV1 (UI §7.1 view)
console.log('\nConfigViewV1Schema');
test('valid config view', () => expectValid(ConfigViewV1Schema, {
  overlay: VALID_OVERLAY,
  apiKeyConfigured: false,
}, 'valid'));
test('valid config view with provider', () => expectValid(ConfigViewV1Schema, {
  roomReference: 'room-1',
  provider: VALID_PROVIDER,
  overlay: VALID_OVERLAY,
  apiKeyConfigured: true,
}, 'with provider'));
test('rejects internalRetrieval in config view', () => expectInvalid(ConfigViewV1Schema, {
  overlay: VALID_OVERLAY,
  apiKeyConfigured: false,
  internalRetrieval: { calibrationVersion: 'v1', directPushThreshold: 0.85, windowMaxAgeMs: 5000, candidateMaxCount: 10 },
}, 'internalRetrieval leaks'));
test('rejects missing apiKeyConfigured', () => expectInvalid(ConfigViewV1Schema, {
  overlay: VALID_OVERLAY,
}, 'missing apiKeyConfigured'));

// ProviderConfigInputV1 (user-submitted provider fields)
console.log('\nProviderConfigInputV1Schema');
test('valid provider input', () => expectValid(ProviderConfigInputV1Schema, {
  displayName: 'DeepSeek',
  adapterType: 'DEEPSEEK',
  baseUrl: 'https://api.deepseek.com',
  modelId: 'deepseek-chat',
}, 'valid'));
test('rejects ANTHROPIC_MESSAGES adapter input', () => expectInvalid(ProviderConfigInputV1Schema, {
  displayName: 'Anthropic',
  adapterType: 'ANTHROPIC_MESSAGES',
  baseUrl: 'https://api.anthropic.com',
  modelId: 'claude',
}, 'anthropic adapter'));
test('rejects http provider input baseUrl', () => expectInvalid(ProviderConfigInputV1Schema, {
  displayName: 'DeepSeek',
  adapterType: 'DEEPSEEK',
  baseUrl: 'http://api.deepseek.com',
  modelId: 'deepseek-chat',
}, 'http url'));
test('rejects provider input with credentialRef', () => expectInvalid(ProviderConfigInputV1Schema, {
  displayName: 'DeepSeek',
  adapterType: 'DEEPSEEK',
  baseUrl: 'https://api.deepseek.com',
  modelId: 'deepseek-chat',
  credentialRef: 'safe-storage:x',
}, 'credentialRef not user-submitted'));

// ConfigUpdateRequestV1
console.log('\nConfigUpdateRequestV1Schema');
test('valid roomReference-only update', () => expectValid(ConfigUpdateRequestV1Schema, { roomReference: 'room-1' }, 'room only'));
test('valid provider-only update', () => expectValid(ConfigUpdateRequestV1Schema, {
  provider: {
    displayName: 'DeepSeek',
    adapterType: 'DEEPSEEK',
    baseUrl: 'https://api.deepseek.com',
    modelId: 'deepseek-chat',
  },
}, 'provider only'));
test('rejects empty update', () => expectInvalid(ConfigUpdateRequestV1Schema, {}, 'empty'));
test('rejects unknown field', () => expectInvalid(ConfigUpdateRequestV1Schema, { roomReference: 'room-1', foo: 1 }, 'unknown field'));

// PersonaSummaryV1 (M6-02 run page, M6-04 persona page)
console.log('\nPersonaSummaryV1Schema');
test('valid persona summary', () => expectValid(PersonaSummaryV1Schema, {
  personaId: 'p-1',
  displayName: '小A',
  isPrincipal: true,
  activeVersion: null,
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
  aliasCount: 0,
  versionCount: 1,
}, 'valid'));
test('rejects persona summary missing isPrincipal', () => expectInvalid(PersonaSummaryV1Schema, {
  personaId: 'p-1',
  displayName: '小A',
  activeVersion: null,
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
  aliasCount: 0,
  versionCount: 1,
}, 'missing isPrincipal'));

// Persona aliases and versions (M6-04)
console.log('\nPersona alias schemas');
test('valid alias input', () => expectValid(AliasInputV1Schema, {
  aliasText: '阿A', aliasKind: 'NICKNAME', enabled: true,
}, 'valid'));
test('rejects alias input with unknown kind', () => expectInvalid(AliasInputV1Schema, {
  aliasText: 'x', aliasKind: 'DISPLAY',
}, 'unknown kind'));
test('valid alias row', () => expectValid(AliasRowV1Schema, {
  aliasId: 'a-1', personaId: 'p-1', aliasText: '阿A', aliasKind: 'NICKNAME', enabled: true,
}, 'valid'));
test('rejects alias row missing enabled', () => expectInvalid(AliasRowV1Schema, {
  aliasId: 'a-1', personaId: 'p-1', aliasText: '阿A', aliasKind: 'NICKNAME',
}, 'missing enabled'));

console.log('\nPersonaVersionMetaV1Schema');
test('valid version meta', () => expectValid(PersonaVersionMetaV1Schema, {
  personaVersion: 'v-1', personaId: 'p-1', status: 'PUBLISHED',
  contentHmac: 'hmac', createdAt: '2026-08-22T00:00:00.000Z',
  publishedAt: '2026-08-22T00:00:00.000Z', createdFromVersion: null,
}, 'valid'));
test('rejects unknown version status', () => expectInvalid(PersonaVersionMetaV1Schema, {
  personaVersion: 'v-1', personaId: 'p-1', status: 'ACTIVE',
  contentHmac: 'hmac', createdAt: '2026-08-22T00:00:00.000Z',
  publishedAt: null, createdFromVersion: null,
}, 'unknown status'));
test('valid version comparison', () => expectValid(VersionComparisonV1Schema, {
  a: { personaVersion: 'v1', personaId: 'p-1', status: 'PUBLISHED', contentHmac: 'h1', createdAt: '2026-08-22T00:00:00.000Z', publishedAt: null, createdFromVersion: null },
  b: { personaVersion: 'v2', personaId: 'p-1', status: 'SUPERSEDED', contentHmac: 'h2', createdAt: '2026-08-22T00:00:00.000Z', publishedAt: null, createdFromVersion: 'v1' },
  sameContent: false,
}, 'valid'));
test('valid persona detail', () => expectValid(PersonaDetailV1Schema, {
  summary: {
    personaId: 'p-1', displayName: '小A', isPrincipal: true, activeVersion: null,
    createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
    aliasCount: 0, versionCount: 0,
  },
  aliases: [],
  versions: [],
  editableContent: '',
}, 'valid'));
test('rejects persona detail missing editableContent', () => expectInvalid(PersonaDetailV1Schema, {
  summary: {
    personaId: 'p-1', displayName: '小A', isPrincipal: true, activeVersion: null,
    createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
    aliasCount: 0, versionCount: 0,
  },
  aliases: [],
  versions: [],
}, 'missing editableContent'));

console.log('\nPersona request schemas');
test('valid persona create with aliases', () => expectValid(PersonaCreateRequestV1Schema, {
  displayName: '小A',
  aliases: [{ aliasText: '阿A', aliasKind: 'NICKNAME' }],
}, 'with aliases'));
test('rejects persona create with empty name', () => expectInvalid(PersonaCreateRequestV1Schema, {
  displayName: '   ',
}, 'empty name'));
test('valid saveDraft with content', () => expectValid(PersonaSaveDraftRequestV1Schema, {
  personaId: 'p-1', content: '温柔',
}, 'content'));
test('valid saveDraft with fromVersion', () => expectValid(PersonaSaveDraftRequestV1Schema, {
  personaId: 'p-1', fromVersion: 'v-1',
}, 'fromVersion'));
test('rejects saveDraft with neither content nor fromVersion', () => expectInvalid(PersonaSaveDraftRequestV1Schema, {
  personaId: 'p-1',
}, 'neither'));
test('valid updateAliases request', () => expectValid(PersonaUpdateAliasesRequestV1Schema, {
  personaId: 'p-1',
  aliases: [{ aliasText: '阿A', aliasKind: 'NICKNAME' }],
}, 'valid'));
test('accepts empty alias list to clear all aliases', () => expectValid(PersonaUpdateAliasesRequestV1Schema, {
  personaId: 'p-1', aliases: [],
}, 'clear all'));
test('rejects updateAliases with an invalid alias kind', () => expectInvalid(PersonaUpdateAliasesRequestV1Schema, {
  personaId: 'p-1',
  aliases: [{ aliasText: 'x', aliasKind: 'DISPLAY' }],
}, 'invalid kind'));

// Safety policy view and requests (UI §7.2)
console.log('\nCompileErrorV1Schema');
test('valid clause compile error', () => expectValid(CompileErrorV1Schema, {
  clauseIndex: 2, message: 'topic is ambiguous or vague',
}, 'clause error'));
test('valid keyword-level compile error', () => expectValid(CompileErrorV1Schema, {
  clauseIndex: -1, message: 'invalid regex pattern for keyword #0',
}, 'keyword error'));
test('rejects clauseIndex below -1', () => expectInvalid(CompileErrorV1Schema, {
  clauseIndex: -2, message: 'x',
}, 'clauseIndex -2'));
test('rejects fractional clauseIndex', () => expectInvalid(CompileErrorV1Schema, {
  clauseIndex: 1.5, message: 'x',
}, 'fractional index'));
test('rejects empty error message', () => expectInvalid(CompileErrorV1Schema, {
  clauseIndex: 0, message: '',
}, 'empty message'));

const SAFETY_META = {
  safetyPolicyVersion: 'sp-1', status: 'DRAFT', compilerVersion: 'SafetyRuleCompilerV1',
  createdAt: '2026-08-22T00:00:00.000Z', publishedAt: null,
};

console.log('\nSafetyPolicyVersionMetaV1Schema');
test('valid safety version meta', () => expectValid(SafetyPolicyVersionMetaV1Schema, SAFETY_META, 'valid'));
test('valid meta for every status', () => {
  for (const status of ['DRAFT', 'PUBLISHED', 'SUPERSEDED', 'INVALID']) {
    expectValid(SafetyPolicyVersionMetaV1Schema, {
      ...SAFETY_META, status,
      publishedAt: status === 'PUBLISHED' ? '2026-08-22T00:00:01.000Z' : null,
    }, status);
  }
});
test('rejects unknown safety status', () => expectInvalid(SafetyPolicyVersionMetaV1Schema, {
  ...SAFETY_META, status: 'ACTIVE',
}, 'unknown status'));

console.log('\nSafetyPolicyCurrentV1Schema');
test('valid safety current content', () => expectValid(SafetyPolicyCurrentV1Schema, {
  versionId: 'sp-1', policyText: '不要讨论主播住址；禁止提及价格。', keywords: ['直播间'], validationErrors: [],
}, 'valid'));
test('valid current content with validation errors', () => expectValid(SafetyPolicyCurrentV1Schema, {
  versionId: 'sp-1', policyText: '不合适的话题都不要说。', keywords: [],
  validationErrors: [{ clauseIndex: 0, message: 'topic is ambiguous or vague' }],
}, 'invalid draft content'));
test('rejects keyword over 64 chars', () => expectInvalid(SafetyPolicyCurrentV1Schema, {
  versionId: 'sp-1', policyText: '', keywords: ['x'.repeat(65)], validationErrors: [],
}, 'keyword too long'));

console.log('\nSafetyPolicyViewV1Schema');
test('valid empty safety view', () => expectValid(SafetyPolicyViewV1Schema, {
  activeVersion: null, current: null, versions: [],
}, 'empty'));
test('valid safety view with active and current', () => expectValid(SafetyPolicyViewV1Schema, {
  activeVersion: { ...SAFETY_META, status: 'PUBLISHED', publishedAt: '2026-08-22T00:00:01.000Z' },
  current: { versionId: 'sp-2', policyText: '', keywords: [], validationErrors: [] },
  versions: [SAFETY_META],
}, 'full view'));
test('rejects compiledRules in safety view', () => expectInvalid(SafetyPolicyViewV1Schema, {
  activeVersion: null, current: null, versions: [], compiledRules: [],
}, 'compiledRules must not cross IPC'));

console.log('\nSafety request/result schemas');
test('valid safety saveDraft request', () => expectValid(SafetySaveDraftRequestV1Schema, {
  policyText: '不要讨论主播住址和真实手机号；禁止回应具体交易价格。', keywords: ['直播间', 'regex:^a+$'],
}, 'valid'));
test('accepts empty policy and keywords', () => expectValid(SafetySaveDraftRequestV1Schema, {
  policyText: '', keywords: [],
}, 'empty'));
test('rejects policy over 50000 chars', () => expectInvalid(SafetySaveDraftRequestV1Schema, {
  policyText: 'x'.repeat(50001), keywords: [],
}, 'policy too long'));
test('rejects 51 keywords', () => expectInvalid(SafetySaveDraftRequestV1Schema, {
  policyText: '', keywords: Array.from({ length: 51 }, (_, i) => `k${i}`),
}, 'too many keywords'));
test('rejects whitespace-only keyword', () => expectInvalid(SafetySaveDraftRequestV1Schema, {
  policyText: '', keywords: ['   '],
}, 'blank keyword'));
test('valid safety publish request', () => expectValid(SafetyPublishRequestV1Schema, {
  safetyPolicyVersion: 'sp-1',
}, 'valid'));
test('rejects empty safety publish version', () => expectInvalid(SafetyPublishRequestV1Schema, {
  safetyPolicyVersion: '',
}, 'empty version'));
test('valid safety saveDraft result', () => expectValid(SafetySaveDraftResultV1Schema, {
  versionMeta: SAFETY_META, valid: true, errors: [],
}, 'valid result'));
test('valid safety saveDraft result with errors', () => expectValid(SafetySaveDraftResultV1Schema, {
  versionMeta: SAFETY_META, valid: false,
  errors: [{ clauseIndex: 0, message: 'topic is ambiguous or vague' }],
}, 'invalid result'));
test('rejects compiledRules in saveDraft result', () => expectInvalid(SafetySaveDraftResultV1Schema, {
  versionMeta: SAFETY_META, valid: true, errors: [], compiledRules: [],
}, 'compiledRules leaks'));

// DiagnosticSummaryV1 (UI §8.1)
console.log('\nDiagnosticSummaryV1Schema');
test('valid diagnostic summary minimal', () => expectValid(DiagnosticSummaryV1Schema, {
  lifecycle: 'STOPPED',
  activity: 'IDLE',
}, 'minimal'));
test('valid diagnostic summary with activity fields', () => expectValid(DiagnosticSummaryV1Schema, {
  lifecycle: 'RUNNING',
  activity: 'DISPLAYING',
  lastCommentReceivedAt: '2026-08-22T12:00:01.000Z',
  lastSuggestionAt: '2026-08-22T12:00:02.000Z',
  lastSuggestionResult: 'displayed',
  lastE2eLatencyMs: 1800,
  lastDomainError: 'E_PROVIDER_TIMEOUT',
}, 'with activity'));
test('valid diagnostic summary with storage capacity (M6-08)', () => expectValid(DiagnosticSummaryV1Schema, {
  lifecycle: 'RUNNING',
  activity: 'LISTENING',
  storageAvailableBytes: 12_884_901_888,
}, 'with storage bytes'));
test('rejects negative storage capacity', () => expectInvalid(DiagnosticSummaryV1Schema, {
  lifecycle: 'STOPPED',
  activity: 'IDLE',
  storageAvailableBytes: -1,
}, 'negative storage bytes'));
test('rejects diagnostic summary with comment text', () => expectInvalid(DiagnosticSummaryV1Schema, {
  lifecycle: 'RUNNING',
  activity: 'LISTENING',
  lastCommentText: '主播晚上好',
}, 'comment text leaks'));
test('rejects unknown lastSuggestionResult', () => expectInvalid(DiagnosticSummaryV1Schema, {
  lifecycle: 'STOPPED',
  activity: 'IDLE',
  lastSuggestionResult: 'shown',
}, 'unknown result'));

// ServiceViewStateSchema
console.log('\nServiceViewStateSchema');
test('valid STOPPED/IDLE', () => expectValid(ServiceViewStateSchema, { lifecycle: 'STOPPED', activity: 'IDLE' }, 'stopped/idle'));
test('valid RUNNING/LISTENING', () => expectValid(ServiceViewStateSchema, { lifecycle: 'RUNNING', activity: 'LISTENING' }, 'running/listening'));
test('valid with stopReason', () => expectValid(ServiceViewStateSchema, {
  lifecycle: 'STOPPED', activity: 'IDLE', stopReason: 'USER_STOP',
}, 'with stopReason'));
test('valid with recoverableError', () => expectValid(ServiceViewStateSchema, {
  lifecycle: 'STOPPED', activity: 'IDLE',
  recoverableError: { code: 'E_PROVIDER_TIMEOUT', at: '2026-01-01T00:00:00Z' },
}, 'with recoverableError'));
test('rejects invalid lifecycle', () => expectInvalid(ServiceViewStateSchema, { lifecycle: 'PAUSED', activity: 'IDLE' }, 'invalid lifecycle'));
test('rejects invalid activity', () => expectInvalid(ServiceViewStateSchema, { lifecycle: 'STOPPED', activity: 'UNKNOWN' }, 'invalid activity'));

// ProviderConfigV1Schema
console.log('\nProviderConfigV1Schema');
test('valid provider', () => expectValid(ProviderConfigV1Schema, VALID_PROVIDER, 'valid'));
test('rejects http baseUrl', () => expectInvalid(ProviderConfigV1Schema, { ...VALID_PROVIDER, baseUrl: 'http://api.deepseek.com' }, 'http url'));
test('rejects baseUrl with query', () => expectInvalid(ProviderConfigV1Schema, { ...VALID_PROVIDER, baseUrl: 'https://api.deepseek.com?foo=bar' }, 'url with query'));
test('rejects baseUrl with hash', () => expectInvalid(ProviderConfigV1Schema, { ...VALID_PROVIDER, baseUrl: 'https://api.deepseek.com#section' }, 'url with hash'));
test('rejects baseUrl with userinfo', () => expectInvalid(ProviderConfigV1Schema, { ...VALID_PROVIDER, baseUrl: 'https://user:pass@api.deepseek.com' }, 'url with userinfo'));

// OverlayPreferenceV1Schema
console.log('\nOverlayPreferenceV1Schema');
test('valid overlay prefs', () => expectValid(OverlayPreferenceV1Schema, VALID_OVERLAY, 'valid'));
test('rejects durationMs < 1000', () => expectInvalid(OverlayPreferenceV1Schema, { ...VALID_OVERLAY, durationMs: 999 }, 'durationMs 999'));
test('rejects durationMs > 60000', () => expectInvalid(OverlayPreferenceV1Schema, { ...VALID_OVERLAY, durationMs: 60001 }, 'durationMs 60001'));
test('rejects opacity < 0.2', () => expectInvalid(OverlayPreferenceV1Schema, { ...VALID_OVERLAY, opacity: 0.1 }, 'opacity 0.1'));
test('rejects invalid theme', () => expectInvalid(OverlayPreferenceV1Schema, { ...VALID_OVERLAY, theme: 'system' }, 'theme system'));

// SuggestionOutputV1Schema
console.log('\nSuggestionOutputV1Schema');
test('valid suggestion', () => expectValid(SuggestionOutputV1Schema, {
  quick_reply: '感谢支持！',
  cues: ['欢迎关注', '点赞收藏'],
}, 'valid'));
test('rejects quick_reply > 80 chars', () => expectInvalid(SuggestionOutputV1Schema, {
  quick_reply: 'a'.repeat(81),
  cues: ['一', '二'],
}, 'quick_reply 81 chars'));
test('rejects only 1 cue', () => expectInvalid(SuggestionOutputV1Schema, {
  quick_reply: '感谢',
  cues: ['只有一个'],
}, '1 cue'));
test('rejects 4 cues', () => expectInvalid(SuggestionOutputV1Schema, {
  quick_reply: '感谢',
  cues: ['一', '二', '三', '四'],
}, '4 cues'));
test('rejects cue > 40 chars', () => expectInvalid(SuggestionOutputV1Schema, {
  quick_reply: '感谢',
  cues: ['一', 'a'.repeat(41)],
}, 'cue 41 chars'));

// OutputValidationReasonV1Schema
console.log('\nOutputValidationReasonV1Schema');
test('accepts all 13 reason codes', () => {
  for (const code of [
    'JSON_PARSE_FAILED', 'JSON_SCHEMA_FAILED', 'UNSAFE_CONTROL_CHAR',
    'EMPTY_QUICK_REPLY', 'QUICK_REPLY_TOO_LONG',
    'CUE_COUNT_INVALID', 'CUE_EMPTY', 'CUE_TOO_LONG', 'CUE_DUPLICATE',
    'RISK_RULE_HIT', 'PERSONAL_INFO_HIT', 'FORBIDDEN_POLICY_HIT',
    'PERSONA_REVIEW_UNCERTAIN',
  ]) {
    expectValid(OutputValidationReasonV1Schema, code, `reason ${code}`);
  }
});
test('rejects an unknown reason code', () => expectInvalid(OutputValidationReasonV1Schema, 'NOT_A_REASON', 'unknown'));

// SuggestionSourceV1Schema
console.log('\nSuggestionSourceV1Schema');
test('accepts llm and retrieval_payload', () => {
  expectValid(SuggestionSourceV1Schema, 'llm', 'llm');
  expectValid(SuggestionSourceV1Schema, 'retrieval_payload', 'retrieval_payload');
});
test('rejects unknown source', () => expectInvalid(SuggestionSourceV1Schema, 'golden', 'unknown'));

// ValidatedSuggestionV1Schema
console.log('\nValidatedSuggestionV1Schema');
test('valid validated suggestion', () => expectValid(ValidatedSuggestionV1Schema, {
  quickReply: '感谢支持！',
  cues: ['欢迎关注', '点赞收藏'],
  source: 'llm',
}, 'valid'));
test('validated suggestion from retrieval_payload', () => expectValid(ValidatedSuggestionV1Schema, {
  quickReply: '谢谢你',
  cues: ['接住夸奖', '继续互动'],
  source: 'retrieval_payload',
}, 'retrieval source'));
test('rejects validated suggestion missing source', () => expectInvalid(ValidatedSuggestionV1Schema, {
  quickReply: '感谢',
  cues: ['一', '二'],
}, 'missing source'));
test('rejects validated suggestion with extra field', () => expectInvalid(ValidatedSuggestionV1Schema, {
  quickReply: '感谢',
  cues: ['一', '二'],
  source: 'llm',
  extra: true,
}, 'extra field'));

// OverlayDisplayPayloadV1Schema
console.log('\nOverlayDisplayPayloadV1Schema');
test('valid overlay payload with nickname', () => expectValid(OverlayDisplayPayloadV1Schema, {
  comment: { nickname: '观众A', text: '主播晚上好' },
  suggestion: { quickReply: '谢谢你', cues: ['接住夸奖', '继续互动'], source: 'llm' },
}, 'with nickname'));
test('valid overlay payload without nickname', () => expectValid(OverlayDisplayPayloadV1Schema, {
  comment: { text: '主播晚上好' },
  suggestion: { quickReply: '谢谢你', cues: ['接住夸奖', '继续互动'], source: 'llm' },
}, 'nickname optional'));
test('rejects overlay payload with empty comment text', () => expectInvalid(OverlayDisplayPayloadV1Schema, {
  comment: { text: '' },
  suggestion: { quickReply: '谢谢你', cues: ['接住夸奖', '继续互动'], source: 'llm' },
}, 'empty text'));
test('rejects overlay payload with over-long nickname', () => expectInvalid(OverlayDisplayPayloadV1Schema, {
  comment: { nickname: 'x'.repeat(65), text: '主播晚上好' },
  suggestion: { quickReply: '谢谢你', cues: ['接住夸奖', '继续互动'], source: 'llm' },
}, 'nickname 65'));
test('rejects overlay payload missing suggestion', () => expectInvalid(OverlayDisplayPayloadV1Schema, {
  comment: { nickname: '观众A', text: '主播晚上好' },
}, 'missing suggestion'));
test('rejects overlay payload with extra field', () => expectInvalid(OverlayDisplayPayloadV1Schema, {
  comment: { nickname: '观众A', text: '主播晚上好' },
  suggestion: { quickReply: '谢谢你', cues: ['接住夸奖', '继续互动'], source: 'llm' },
  meta: {},
}, 'extra meta field'));

// OverlayDisplayRequestV1Schema
console.log('\nOverlayDisplayRequestV1Schema');
test('valid overlay display request', () => expectValid(OverlayDisplayRequestV1Schema, {
  requestId: 'req-1',
  payload: {
    comment: { nickname: '观众A', text: '主播晚上好' },
    suggestion: { quickReply: '谢谢你', cues: ['接住夸奖', '继续互动'], source: 'llm' },
  },
}, 'valid'));
test('rejects overlay display request with empty requestId', () => expectInvalid(OverlayDisplayRequestV1Schema, {
  requestId: '',
  payload: {
    comment: { text: '主播晚上好' },
    suggestion: { quickReply: '谢谢你', cues: ['接住夸奖', '继续互动'], source: 'llm' },
  },
}, 'empty requestId'));
test('rejects overlay display request missing payload', () => expectInvalid(OverlayDisplayRequestV1Schema, {
  requestId: 'req-1',
}, 'missing payload'));

// OverlayAckRequestV1Schema
console.log('\nOverlayAckRequestV1Schema');
test('valid overlay ack', () => expectValid(OverlayAckRequestV1Schema, { requestId: 'req-1' }, 'valid'));
test('rejects overlay ack with empty requestId', () => expectInvalid(OverlayAckRequestV1Schema, { requestId: '' }, 'empty requestId'));

// AuditSearchRequestV1Schema
console.log('\nAuditSearchRequestV1Schema');
test('valid empty request uses defaults', () => {
  const result = AuditSearchRequestV1Schema.parse({});
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 20);
});
test('rejects pageSize > 100', () => expectInvalid(AuditSearchRequestV1Schema, { pageSize: 101 }, 'pageSize 101'));
test('rejects page < 1', () => expectInvalid(AuditSearchRequestV1Schema, { page: 0 }, 'page 0'));

// AuditGetWorkflowRequestV1Schema
console.log('\nAuditGetWorkflowRequestV1Schema');
test('valid uuid v7', () => expectValid(AuditGetWorkflowRequestV1Schema, {
  traceId: '01932a3b-4c5d-7000-8000-000000000001',
}, 'uuid v7'));
test('rejects uuid v4', () => expectInvalid(AuditGetWorkflowRequestV1Schema, {
  traceId: '550e8400-e29b-41d4-a716-446655440000',
}, 'uuid v4'));

// AuditSubmitLabelRequestV1Schema
console.log('\nAuditSubmitLabelRequestV1Schema');
const VALID_TRACE_ID = '01932a3b-4c5d-7000-8000-000000000001';
test('valid label without correction', () => expectValid(AuditSubmitLabelRequestV1Schema, {
  traceId: VALID_TRACE_ID,
  expectedRevisionNo: 0,
  score: 90,
}, 'no correction'));
test('valid label with full correction', () => expectValid(AuditSubmitLabelRequestV1Schema, {
  traceId: VALID_TRACE_ID,
  expectedRevisionNo: 0,
  score: 70,
  correctedQuickReply: '修正回复',
  correctedCues: ['修正提词一', '修正提词二'],
}, 'with correction'));
test('rejects reply without cues', () => expectInvalid(AuditSubmitLabelRequestV1Schema, {
  traceId: VALID_TRACE_ID,
  expectedRevisionNo: 0,
  score: 70,
  correctedQuickReply: '只有回复',
}, 'reply without cues'));
test('rejects cues without reply', () => expectInvalid(AuditSubmitLabelRequestV1Schema, {
  traceId: VALID_TRACE_ID,
  expectedRevisionNo: 0,
  score: 70,
  correctedCues: ['只有提词', '没有回复'],
}, 'cues without reply'));
test('rejects score > 100', () => expectInvalid(AuditSubmitLabelRequestV1Schema, {
  traceId: VALID_TRACE_ID,
  expectedRevisionNo: 0,
  score: 101,
}, 'score 101'));

// Enums
console.log('\nEnum schemas');
test('rejects invalid TraceState', () => expectInvalid(TraceStateSchema, 'PROCESSING', 'invalid trace state'));
test('rejects invalid DomainErrorV1', () => expectInvalid(DomainErrorV1Schema, 'E_UNKNOWN', 'invalid domain error'));

// LiveSourceEventSchema
console.log('\nLiveSourceEventSchema');
test('valid LIVE_ONLINE', () => expectValid(LiveSourceEventSchema, {
  type: 'LIVE_ONLINE', roomReference: 'room-abc', platformRoomId: '7012345678901234567',
  receivedAt: '2026-08-22T12:00:00.000Z',
}, 'live online'));
test('valid LIVE_OFFLINE', () => expectValid(LiveSourceEventSchema, {
  type: 'LIVE_OFFLINE', roomReference: 'room-abc', receivedAt: '2026-08-22T12:05:00.000Z',
}, 'live offline'));
test('valid LIVE_ENDED', () => expectValid(LiveSourceEventSchema, {
  type: 'LIVE_ENDED', roomReference: 'room-abc', receivedAt: '2026-08-22T12:10:00.000Z',
}, 'live ended'));
test('valid COMMENT', () => expectValid(LiveSourceEventSchema, {
  type: 'COMMENT',
  comment: {
    sourceMessageId: '7261234567890123456',
    rawEvent: { method: 'WebcastChatMessage', content: '主播晚上好' },
    rawText: '主播晚上好',
    normalizedText: '主播晚上好',
    receivedAt: '2026-08-22T12:00:01.000Z',
    receivedMonotonicMs: 12345.678,
  },
}, 'comment'));
test('valid SOURCE_ERROR', () => expectValid(LiveSourceEventSchema, {
  type: 'SOURCE_ERROR', code: 'E_SOURCE_UNAVAILABLE', message: 'connection lost',
  receivedAt: '2026-08-22T12:00:02.000Z',
}, 'source error'));
test('rejects unknown event type', () => expectInvalid(LiveSourceEventSchema, {
  type: 'LIVE_END', roomReference: 'room-abc', receivedAt: '2026-08-22T12:00:00.000Z',
}, 'unknown type'));
test('rejects gift frame (no discriminator)', () => expectInvalid(LiveSourceEventSchema, {
  method: 'WebcastGiftMessage', gift: { giftName: '小心心' },
  common: { msgId: 7262000000000000001, roomId: 7012345678901234567 },
}, 'gift frame'));

// SourceCommentSchema
console.log('\nSourceCommentSchema');
test('rejects negative receivedMonotonicMs', () => expectInvalid(SourceCommentSchema, {
  sourceMessageId: '7261234567890123456',
  rawEvent: {},
  rawText: '主播晚上好',
  normalizedText: '主播晚上好',
  receivedAt: '2026-08-22T12:00:01.000Z',
  receivedMonotonicMs: -1,
}, 'negative monotonic'));
test('rejects missing sourceMessageId', () => expectInvalid(SourceCommentSchema, {
  rawEvent: {},
  rawText: '主播晚上好',
  normalizedText: '主播晚上好',
  receivedAt: '2026-08-22T12:00:01.000Z',
  receivedMonotonicMs: 0,
}, 'missing message id'));

// Provider connection test result (CONTRACT §7)
console.log('\nProvider connection test result');
test('accepts all three statuses', () => {
  expectValid(ConnectionTestResultV1Schema, { status: 'OK' }, 'ok');
  expectValid(ConnectionTestResultV1Schema, { status: 'AUTH_FAILED' }, 'auth failed');
  expectValid(ConnectionTestResultV1Schema, { status: 'UNAVAILABLE' }, 'unavailable');
});
test('rejects unknown status and extra fields', () => {
  expectInvalid(ConnectionTestResultV1Schema, { status: 'MAYBE' }, 'unknown status');
  expectInvalid(ConnectionTestResultV1Schema, { status: 'OK', extra: 1 }, 'extra field');
  expectInvalid(ConnectionTestResultV1Schema, {}, 'missing status');
});

// Provider fixture case (CONTRACT §6)
console.log('\nProvider fixture case');
test('accepts a full fixture case', () => {
  expectValid(ProviderFixtureCaseV1Schema, {
    id: 'deepseek-json-success',
    adapterType: 'DEEPSEEK',
    config: {
      providerId: 'deepseek-primary',
      displayName: '首选模型服务',
      adapterType: 'DEEPSEEK',
      baseUrl: 'https://api.deepseek.com',
      modelId: 'configured-model-id',
      credentialRef: 'safe-storage:deepseek-primary',
    },
    request: { method: 'POST', path: '/chat/completions', body: {} },
    response: { status: 200, body: {} },
    expected: { ok: true },
  }, 'full case');
});
test('rejects a fixture case with a non-https config and an unknown adapterType', () => {
  expectInvalid(ProviderFixtureCaseV1Schema, {
    id: 'bad',
    config: {
      providerId: 'p',
      displayName: 't',
      adapterType: 'DEEPSEEK',
      baseUrl: 'http://insecure.example.com',
      modelId: 'm',
      credentialRef: 'safe-storage:p',
    },
    expected: { ok: true },
  }, 'non-https config');
  expectInvalid(ProviderFixtureResponseV1Schema, {
    status: 0,
    body: {},
  }, 'non-positive status');
  expectInvalid(ProviderFixtureExpectedV1Schema, {
    ok: 'yes',
  }, 'non-boolean ok');
  expectInvalid(ProviderFixtureCaseV1Schema, {
    id: 'bad',
    adapterType: 'ANTHROPIC_MESSAGES',
    expected: { ok: true },
  }, 'unsupported fixture adapterType');
});

// Transition constants
console.log('\nTransition constants');
test('SERVICE_LIFECYCLE_TRANSITIONS_V1 structure', () => {
  assert.deepEqual(SERVICE_LIFECYCLE_TRANSITIONS_V1.STOPPED, ['GATE_CONNECTING']);
  assert.deepEqual(SERVICE_LIFECYCLE_TRANSITIONS_V1.RUNNING, ['STOPPED']);
});
test('TRACE_TRANSITIONS_V1 terminal states have empty arrays', () => {
  assert.deepEqual(TRACE_TRANSITIONS_V1.FILTERED, []);
  assert.deepEqual(TRACE_TRANSITIONS_V1.HIDDEN, []);
  assert.deepEqual(TRACE_TRANSITIONS_V1.DISCARDED, []);
  assert.deepEqual(TRACE_TRANSITIONS_V1.FAILED, []);
});
test('OUTBOX_TRANSITIONS_V1 SUCCEEDED is terminal', () => {
  assert.deepEqual(OUTBOX_TRANSITIONS_V1.SUCCEEDED, []);
});

// Summary
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
