import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'node:crypto';
import {
  AuditStoreWorker,
  type AppendSnapshotInput,
} from '../../src/main/storage/index.js';
import { CryptoKeyManager } from '../../src/main/crypto/key-manager.js';
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

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-taud001-'));
    const credStore = new CredentialStore(testDir, mockStorage);
    const keyManager = new CryptoKeyManager(credStore);
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
    expect(all.items[1].commentText).toBe('加微信');
    expect(all.items[1].hasSuggestion).toBe(false);
    expect(all.items[1].finalState).toBe('FILTERED');

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

  it.todo('should decrypt fields for authorized reader');
});
