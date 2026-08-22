/**
 * Echocue contract package test — runs directly with Node.js (no test framework).
 * Validates key schemas for normal, boundary, and failure paths.
 */
import { strict as assert } from 'assert';
import {
  SettingsV1Schema,
  ServiceViewStateSchema,
  ProviderConfigV1Schema,
  OverlayPreferenceV1Schema,
  SuggestionOutputV1Schema,
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
