import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  AuditStoreWorker,
  type AppendSnapshotInput,
} from '../../src/main/storage/index.js';
import { PersonaStore } from '../../src/main/persona/index.js';
import { CryptoKeyManager } from '../../src/main/crypto/key-manager.js';
import { FieldEncryptor, buildAad } from '../../src/main/crypto/field-encryptor.js';
import { CredentialStore } from '../../src/main/credentials/CredentialStore.js';

const MIGRATION_PATH = join(
  process.cwd(),
  'docs/06-data-interface/migrations/001_initial_schema.sql',
);

const mockStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf-8'),
};

function snap(
  contentType: AppendSnapshotInput['contentType'],
  role: AppendSnapshotInput['role'],
  payload: unknown,
): AppendSnapshotInput {
  return { snapshotId: randomUUID(), contentType, role, plaintext: Buffer.from(JSON.stringify(payload)) };
}

describe('T-AUD-001: Audit Storage', () => {
  let testDir: string;
  let worker: AuditStoreWorker;
  let keyManager: CryptoKeyManager;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-taud001-'));
    const credStore = new CredentialStore(testDir, mockStorage);
    keyManager = new CryptoKeyManager(credStore);
    await keyManager.ensureKeys('v1');
    worker = new AuditStoreWorker({
      dbPath: join(testDir, 'audit.sqlite'),
      migrations: [{ version: 1, path: MIGRATION_PATH }],
      keyManager,
      keyVersion: 'v1',
    });
  });

  afterEach(async () => {
    worker.close();
    await rm(testDir, { recursive: true, force: true });
  });

  // Creates a persona + one published version so submitLabel's FK to
  // persona_version(persona_id, persona_version) resolves.
  function setupPersonaAndVersion(): { personaId: string; personaVersion: string } {
    const personaStore = new PersonaStore({
      dbPath: join(testDir, 'audit.sqlite'),
      migrations: [{ version: 1, path: MIGRATION_PATH }],
      keyManager,
      keyVersion: 'v1',
    });
    try {
      personaStore.createPersona({ personaId: 'p-1', displayName: '主播A', isPrincipal: true });
      const draft = personaStore.createDraft({ personaId: 'p-1', content: '你是一个温柔的主播。' });
      personaStore.publishDraft(draft.personaVersion);
      return { personaId: 'p-1', personaVersion: draft.personaVersion };
    } finally {
      personaStore.close();
    }
  }

  it.todo('should write and read audit traces');
  it.todo('should enforce hash chain integrity');
  it.todo('should reject invalid state transitions');
  it.todo('should stop service on write failure');

  it('writes and replays the four LLM-path snapshot roles (M5-09)', () => {
    const sessionId = randomUUID();
    const traceId = randomUUID();
    const now = new Date().toISOString();
    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-1', receivedAt: now });

    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED');
    worker.appendTransition(traceId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
    worker.appendTransition(traceId, 'NORMALIZED', 'ROUTED', 'PERSONA_ROUTED');
    worker.appendTransition(traceId, 'ROUTED', 'RETRIEVING', 'RETRIEVAL_STARTED');
    worker.appendTransition(traceId, 'RETRIEVING', 'PROMPT_RENDERED', 'LLM_REQUIRED', [
      snap('PROMPT_TEXT', 'RENDERED_PROMPT', {
        templateVersion: 'v1',
        assemblerVersion: 'v1',
        system: '你是一个主播。',
        user: '弹幕：主播晚上好',
        personaId: 'p-1',
        personaVersion: 'v-1',
        personaContentHmac: 'hmac-v1',
        safetyVersion: 'pol-v1',
      }),
    ]);
    worker.appendTransition(traceId, 'PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED', [
      snap('PROVIDER_META_JSON', 'LLM_REQUEST_META', {
        providerId: 'deepseek',
        adapterType: 'DEEPSEEK',
        baseUrlOrigin: 'https://api.deepseek.com',
        modelId: 'deepseek-chat',
        callMode: 'non-streaming-json',
      }),
    ]);
    worker.appendTransition(traceId, 'LLM_PENDING', 'GENERATED', 'PROVIDER_SUCCEEDED', [
      snap('PROVIDER_RESPONSE_JSON', 'LLM_RAW_RESPONSE', {
        rawResponse: { choices: [{ message: { content: '{"quick_reply":"谢谢你","cues":["一","二"]}' } }] },
        httpStatus: 200,
      }),
      snap('SUGGESTION_JSON', 'LLM_PARSED_OUTPUT', {
        quickReply: '谢谢你',
        cues: ['一', '二'],
        parserVersion: 'SuggestionOutputV1',
      }),
    ]);
    worker.appendTransition(traceId, 'GENERATED', 'DISPLAY_READY', 'OUTPUT_VALIDATED');
    worker.appendTransition(traceId, 'DISPLAY_READY', 'DISPLAYED', 'OVERLAY_RENDERED');
    worker.appendTransition(traceId, 'DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED');

    const workflow = worker.getTraceWorkflow(traceId);
    expect(workflow).not.toBeNull();
    const allSnapshots = workflow!.transitions.flatMap((t) => t.snapshots);
    const roles = allSnapshots.map((s) => s.role);
    expect(roles).toEqual(
      expect.arrayContaining(['RENDERED_PROMPT', 'LLM_REQUEST_META', 'LLM_RAW_RESPONSE', 'LLM_PARSED_OUTPUT']),
    );

    // Decrypted replay matches the exact payloads (LLM §7 replay).
    const rendered = allSnapshots.find((s) => s.role === 'RENDERED_PROMPT')!;
    expect(JSON.parse(rendered.plaintext.toString())).toMatchObject({ templateVersion: 'v1', personaId: 'p-1' });
    const parsed = allSnapshots.find((s) => s.role === 'LLM_PARSED_OUTPUT')!;
    expect(JSON.parse(parsed.plaintext.toString())).toMatchObject({ quickReply: '谢谢你' });
    // audit_reference integrity: each snapshot carries its linked content type + HMAC.
    expect(rendered.contentType).toBe('PROMPT_TEXT');
    expect(rendered.contentHmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns null for an unknown trace', () => {
    expect(worker.getTraceWorkflow(randomUUID())).toBeNull();
  });

  it('searchTraces filters, paginates, decrypts comment preview, and flags suggestions (M6-09)', () => {
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });

    const displayedId = randomUUID();
    worker.createTrace({ traceId: displayedId, sessionId, sourceMessageId: 'msg-1', receivedAt: now });
    worker.appendTransition(displayedId, null, 'RECEIVED', 'EVENT_RECEIVED', [
      snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', {
        sourceMessageId: 'msg-1',
        rawText: '主播晚上好',
        normalizedText: '主播晚上好',
        receivedAt: now,
        receivedMonotonicMs: 1,
      }),
    ]);
    worker.appendTransition(displayedId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
    worker.appendTransition(displayedId, 'NORMALIZED', 'ROUTED', 'PERSONA_ROUTED');
    worker.appendTransition(displayedId, 'ROUTED', 'RETRIEVING', 'RETRIEVAL_STARTED');
    worker.appendTransition(displayedId, 'RETRIEVING', 'PROMPT_RENDERED', 'LLM_REQUIRED');
    worker.appendTransition(displayedId, 'PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED');
    worker.appendTransition(displayedId, 'LLM_PENDING', 'GENERATED', 'PROVIDER_SUCCEEDED');
    worker.appendTransition(displayedId, 'GENERATED', 'DISPLAY_READY', 'OUTPUT_VALIDATED');
    worker.appendTransition(displayedId, 'DISPLAY_READY', 'DISPLAYED', 'OVERLAY_RENDERED');
    worker.appendTransition(displayedId, 'DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED');

    const filteredId = randomUUID();
    const filteredAt = new Date(Date.now() - 60_000).toISOString();
    worker.createTrace({ traceId: filteredId, sessionId, sourceMessageId: 'msg-2', receivedAt: filteredAt });
    worker.appendTransition(filteredId, null, 'RECEIVED', 'EVENT_RECEIVED', [
      snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', {
        sourceMessageId: 'msg-2',
        rawText: '加微信',
        normalizedText: '加微信',
        receivedAt: filteredAt,
        receivedMonotonicMs: 2,
      }),
    ]);
    worker.appendTransition(filteredId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
    worker.appendTransition(filteredId, 'NORMALIZED', 'FILTERED', 'INPUT_SAFETY_FILTERED');

    // All rows, newest first.
    const all = worker.searchTraces({ page: 1, pageSize: 50 });
    expect(all.total).toBe(2);
    expect(all.items[0].traceId).toBe(displayedId); // newer receivedAt first
    expect(all.items[0].commentText).toBe('主播晚上好');
    expect(all.items[0].hasSuggestion).toBe(true);
    expect(all.items[0].finalState).toBe('HIDDEN');
    expect(all.items[0].revisionCount).toBe(0);
    expect(all.items[1].commentText).toBe('加微信');
    expect(all.items[1].hasSuggestion).toBe(false);
    expect(all.items[1].finalState).toBe('FILTERED');
    expect(all.items[1].revisionCount).toBe(0);

    // finalState + labelStatus filters.
    const hidden = worker.searchTraces({ page: 1, pageSize: 50, finalState: 'HIDDEN' });
    expect(hidden.total).toBe(1);
    expect(hidden.items[0].traceId).toBe(displayedId);
    const labeled = worker.searchTraces({ page: 1, pageSize: 50, labelStatus: 'UNLABELED' });
    expect(labeled.total).toBe(2);

    // Pagination with a bound on pageSize (1-100 enforced by the schema upstream).
    const page2 = worker.searchTraces({ page: 2, pageSize: 1 });
    expect(page2.total).toBe(2);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].traceId).toBe(filteredId);
  });

  it('searchTraces filters by time range and clamps pageSize defensively (M6-09 review)', () => {
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    const traceId = randomUUID();
    const earlier = new Date(Date.now() - 3_600_000).toISOString();
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-1', receivedAt: earlier });
    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED');
    worker.appendTransition(traceId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
    worker.appendTransition(traceId, 'NORMALIZED', 'FILTERED', 'INPUT_SAFETY_FILTERED');

    // Offset datetime normalized to UTC on the same timeline.
    const from = new Date(Date.now() - 7_200_000).toISOString().replace('Z', '+08:00');
    const filtered = worker.searchTraces({ page: 1, pageSize: 50, from });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].traceId).toBe(traceId);

    const outOfRange = worker.searchTraces({
      page: 1,
      pageSize: 50,
      from: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(outOfRange.total).toBe(0);

    // pageSize over 100 is clamped to 100 rather than accepted blindly.
    const clamped = worker.searchTraces({ page: 1, pageSize: 500 });
    expect(clamped.pageSize).toBe(100);
    const clampedDown = worker.searchTraces({ page: 1, pageSize: 0 });
    expect(clampedDown.pageSize).toBe(1);
  });

  it('getTraceWorkflowV1 serializes plaintext as utf-8 strings (M6-09)', () => {
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    const traceId = randomUUID();
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-1', receivedAt: now });
    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED', [
      snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', {
        sourceMessageId: 'msg-1',
        rawText: '主播晚上好',
        normalizedText: '主播晚上好',
        receivedAt: now,
        receivedMonotonicMs: 1,
      }),
    ]);

    const wf = worker.getTraceWorkflowV1(traceId);
    expect(wf).not.toBeNull();
    const snapshots = wf!.transitions.flatMap((t) => t.snapshots);
    expect(snapshots).toHaveLength(1);
    expect(typeof snapshots[0].plaintext).toBe('string');
    expect(JSON.parse(snapshots[0].plaintext)).toMatchObject({ normalizedText: '主播晚上好' });
  });

  it('getTraceWorkflowV1 returns null for an unknown trace', () => {
    expect(worker.getTraceWorkflowV1(randomUUID())).toBeNull();
  });

  it('submitLabel writes a revision, updates trace status, and creates no outbox job (M6-10)', () => {
    const { personaVersion } = setupPersonaAndVersion();
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    const traceId = randomUUID();
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-1', receivedAt: now });
    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED', [
      snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', {
        sourceMessageId: 'msg-1',
        rawText: '主播晚上好',
        normalizedText: '主播晚上好',
        receivedAt: now,
        receivedMonotonicMs: 1,
      }),
    ]);
    worker.appendTransition(traceId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
    worker.appendTransition(traceId, 'NORMALIZED', 'ROUTED', 'PERSONA_ROUTED', [
      snap('DECISION_JSON', 'PERSONA_ROUTE', { personaId: 'p-1' }),
      snap('PERSONA_TEXT', 'PERSONA_VERSION_SNAPSHOT', {
        personaId: 'p-1',
        personaVersion,
        content: '你是主播。',
        contentHmac: 'hmac-v1',
      }),
    ]);
    worker.appendTransition(traceId, 'ROUTED', 'RETRIEVING', 'RETRIEVAL_STARTED');
    worker.appendTransition(traceId, 'RETRIEVING', 'PROMPT_RENDERED', 'LLM_REQUIRED');
    worker.appendTransition(traceId, 'PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED');
    worker.appendTransition(traceId, 'LLM_PENDING', 'GENERATED', 'PROVIDER_SUCCEEDED');
    worker.appendTransition(traceId, 'GENERATED', 'DISPLAY_READY', 'OUTPUT_VALIDATED');
    worker.appendTransition(traceId, 'DISPLAY_READY', 'DISPLAYED', 'OVERLAY_RENDERED');
    worker.appendTransition(traceId, 'DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED');

    const status = worker.submitLabel({
      traceId,
      expectedRevisionNo: 0,
      score: 90,
    });
    expect(status).toBe('ACCEPTED');

    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    try {
      const feedback = reader.prepare(
        `SELECT revision_no, label_status, quality_score, source_collection, source_point_id, is_bad_case
         FROM suggestion_feedback WHERE trace_id = ?`,
      ).get(traceId) as {
        revision_no: number;
        label_status: string;
        quality_score: number;
        source_collection: string | null;
        source_point_id: string | null;
        is_bad_case: number;
      };
      expect(feedback.revision_no).toBe(1);
      expect(feedback.label_status).toBe('ACCEPTED');
      expect(feedback.quality_score).toBe(90);
      expect(feedback.source_collection).toBeNull();
      // No outbox job is created by M6-10 (reflux is M7-01).
      const jobs = reader.prepare('SELECT COUNT(*) as n FROM qdrant_sync_job').get() as { n: number };
      expect(jobs.n).toBe(0);

      const trace = reader.prepare(
        `SELECT label_status, current_feedback_id FROM audit_trace WHERE trace_id = ?`,
      ).get(traceId) as { label_status: string; current_feedback_id: string };
      expect(trace.label_status).toBe('ACCEPTED');
      expect(trace.current_feedback_id).toBeTruthy();
    } finally {
      reader.close();
    }
  });

  it('submitLabel increments revisions on edits and rejects a stale optimistic lock (M6-10)', () => {
    const { personaVersion } = setupPersonaAndVersion();
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    const traceId = randomUUID();
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-1', receivedAt: now });
    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED', [
      snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', {
        sourceMessageId: 'msg-1',
        rawText: '主播晚上好',
        normalizedText: '主播晚上好',
        receivedAt: now,
        receivedMonotonicMs: 1,
      }),
    ]);
    worker.appendTransition(traceId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
    worker.appendTransition(traceId, 'NORMALIZED', 'ROUTED', 'PERSONA_ROUTED', [
      snap('DECISION_JSON', 'PERSONA_ROUTE', { personaId: 'p-1' }),
      snap('PERSONA_TEXT', 'PERSONA_VERSION_SNAPSHOT', {
        personaId: 'p-1',
        personaVersion,
        content: '你是主播。',
        contentHmac: 'hmac-v1',
      }),
    ]);
    worker.appendTransition(traceId, 'ROUTED', 'RETRIEVING', 'RETRIEVAL_STARTED');
    worker.appendTransition(traceId, 'RETRIEVING', 'PROMPT_RENDERED', 'LLM_REQUIRED');
    worker.appendTransition(traceId, 'PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED');
    worker.appendTransition(traceId, 'LLM_PENDING', 'GENERATED', 'PROVIDER_SUCCEEDED');
    worker.appendTransition(traceId, 'GENERATED', 'DISPLAY_READY', 'OUTPUT_VALIDATED');
    worker.appendTransition(traceId, 'DISPLAY_READY', 'DISPLAYED', 'OVERLAY_RENDERED');
    worker.appendTransition(traceId, 'DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED');

    worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 85 });
    worker.submitLabel({ traceId, expectedRevisionNo: 1, score: 70 });
    // A concurrent editor who still sees revision 1 must be rejected.
    expect(() => worker.submitLabel({ traceId, expectedRevisionNo: 1, score: 60 })).toThrow(
      /label already changed/,
    );

    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    try {
      const rows = reader.prepare(
        `SELECT revision_no, quality_score FROM suggestion_feedback WHERE trace_id = ? ORDER BY revision_no`,
      ).all(traceId) as Array<{ revision_no: number; quality_score: number }>;
      expect(rows.map((r) => r.revision_no)).toEqual([1, 2]);
      expect(rows.map((r) => r.quality_score)).toEqual([85, 70]);
      const jobs = reader.prepare('SELECT COUNT(*) as n FROM qdrant_sync_job').get() as { n: number };
      expect(jobs.n).toBe(0);
    } finally {
      reader.close();
    }
  });

  it('submitLabel rejects a trace with no final suggestion (M6-10)', () => {
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    const traceId = randomUUID();
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-2', receivedAt: now });
    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED', [
      snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', {
        sourceMessageId: 'msg-2',
        rawText: '加微信',
        normalizedText: '加微信',
        receivedAt: now,
        receivedMonotonicMs: 1,
      }),
    ]);
    worker.appendTransition(traceId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
    worker.appendTransition(traceId, 'NORMALIZED', 'FILTERED', 'INPUT_SAFETY_FILTERED');

    expect(() => worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 0 })).toThrow(
      /no final suggestion/,
    );
  });

  it('correction_envelope round-trips through the encryptor (M6-10 review / M-2)', () => {
    const { personaVersion } = setupPersonaAndVersion();
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    const traceId = randomUUID();
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-1', receivedAt: now });
    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED', [
      snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', {
        sourceMessageId: 'msg-1', rawText: '主播晚上好', normalizedText: '主播晚上好',
        receivedAt: now, receivedMonotonicMs: 1,
      }),
    ]);
    worker.appendTransition(traceId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
    worker.appendTransition(traceId, 'NORMALIZED', 'ROUTED', 'PERSONA_ROUTED', [
      snap('DECISION_JSON', 'PERSONA_ROUTE', { personaId: 'p-1' }),
      snap('PERSONA_TEXT', 'PERSONA_VERSION_SNAPSHOT', {
        personaId: 'p-1', personaVersion, content: '你是主播。', contentHmac: 'hmac-v1',
      }),
    ]);
    worker.appendTransition(traceId, 'ROUTED', 'RETRIEVING', 'RETRIEVAL_STARTED');
    worker.appendTransition(traceId, 'RETRIEVING', 'PROMPT_RENDERED', 'LLM_REQUIRED');
    worker.appendTransition(traceId, 'PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED');
    worker.appendTransition(traceId, 'LLM_PENDING', 'GENERATED', 'PROVIDER_SUCCEEDED');
    worker.appendTransition(traceId, 'GENERATED', 'DISPLAY_READY', 'OUTPUT_VALIDATED');
    worker.appendTransition(traceId, 'DISPLAY_READY', 'DISPLAYED', 'OVERLAY_RENDERED');
    worker.appendTransition(traceId, 'DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED');

    const status = worker.submitLabel({
      traceId,
      expectedRevisionNo: 0,
      score: 85,
      correctedQuickReply: '谢谢大家！',
      correctedCues: ['接住夸奖', '邀请互动'],
    });
    expect(status).toBe('CORRECTED');

    // Read the stored envelope + feedback_id and decrypt it the same way M7-01
    // reflux will: FieldEncryptor + buildAad(suggestion_feedback, feedback_id).
    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    try {
      const row = reader.prepare(
        `SELECT feedback_id, correction_envelope FROM suggestion_feedback WHERE trace_id = ?`,
      ).get(traceId) as { feedback_id: string; correction_envelope: Uint8Array };
      const encryptor = new FieldEncryptor(keyManager.getDek('v1'), 'v1');
      const plaintext = encryptor.decrypt(
        Buffer.from(row.correction_envelope),
        buildAad('suggestion_feedback', row.feedback_id, 'CORRECTION_JSON'),
      );
      expect(JSON.parse(plaintext.toString('utf-8'))).toMatchObject({
        correctedQuickReply: '谢谢大家！',
        correctedCues: ['接住夸奖', '邀请互动'],
      });
    } finally {
      reader.close();
    }
  });

  it('golden direct + rejected without correction sets is_bad_case=1 (M6-10 review)', () => {
    const { personaVersion } = setupPersonaAndVersion();
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    const traceId = randomUUID();
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-1', receivedAt: now });
    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED', [
      snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', {
        sourceMessageId: 'msg-1', rawText: '主播晚上好', normalizedText: '主播晚上好',
        receivedAt: now, receivedMonotonicMs: 1,
      }),
    ]);
    worker.appendTransition(traceId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
    worker.appendTransition(traceId, 'NORMALIZED', 'ROUTED', 'PERSONA_ROUTED', [
      snap('DECISION_JSON', 'PERSONA_ROUTE', { personaId: 'p-1' }),
      snap('PERSONA_TEXT', 'PERSONA_VERSION_SNAPSHOT', {
        personaId: 'p-1', personaVersion, content: '你是主播。', contentHmac: 'hmac-v1',
      }),
    ]);
    worker.appendTransition(traceId, 'ROUTED', 'RETRIEVING', 'RETRIEVAL_STARTED');
    // golden direct path
    worker.appendTransition(traceId, 'RETRIEVING', 'DIRECT_READY', 'GOLDEN_DIRECT_ELIGIBLE', [
      snap('SUGGESTION_JSON', 'DIRECT_PAYLOAD', { quick_reply: '谢谢你', cues: ['一', '二'] }),
      snap('DECISION_JSON', 'DIRECT_DECISION', { eligible: true, pointId: 'golden-1', reason: 'GOLDEN_DIRECT_ELIGIBLE' }),
    ]);
    worker.appendTransition(traceId, 'DIRECT_READY', 'DISPLAY_READY', 'OUTPUT_VALIDATED');
    worker.appendTransition(traceId, 'DISPLAY_READY', 'DISPLAYED', 'OVERLAY_RENDERED');
    worker.appendTransition(traceId, 'DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED');

    const status = worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 0 });
    expect(status).toBe('REJECTED');

    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    try {
      const row = reader.prepare(
        `SELECT is_bad_case, source_collection, source_point_id FROM suggestion_feedback WHERE trace_id = ?`,
      ).get(traceId) as { is_bad_case: number; source_collection: string; source_point_id: string };
      expect(row.is_bad_case).toBe(1);
      expect(row.source_collection).toBe('golden_set');
      expect(row.source_point_id).toBe('golden-1');
      // No outbox job yet (M7-01 owns reflux).
      const jobs = reader.prepare('SELECT COUNT(*) as n FROM qdrant_sync_job').get() as { n: number };
      expect(jobs.n).toBe(0);
    } finally {
      reader.close();
    }
  });

  it.todo('should decrypt fields for authorized reader');
});
