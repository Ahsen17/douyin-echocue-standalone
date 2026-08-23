import { QdrantClient } from '@qdrant/js-client-rest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseSync } from 'node:sqlite';
import type { AppendSnapshotInput } from '../../../src/main/storage/index.js';
import { AuditStoreWorker } from '../../../src/main/storage/index.js';
import { PersonaStore } from '../../../src/main/persona/index.js';
import { CryptoKeyManager } from '../../../src/main/crypto/key-manager.js';
import { CredentialStore } from '../../../src/main/credentials/CredentialStore.js';
import { GoldenSyncWorker, readGoldenProfile } from '../../../src/main/reflux/index.js';
import {
  SuggestionRetriever,
  bootstrapPreSet,
  buildDocumentVector,
  createBm25TextPipeline,
} from '../../../src/main/retrieval/index.js';
import type { GoldenSetPayloadV1 } from '@echocue/contracts';
import { uuidv5, uuidv7 } from '../../../src/main/util/index.js';
import { resolveQdrantBinary, startTestQdrant, type TestQdrant } from '../retrieval/qdrant-test-utils.js';

const MIGRATION_PATH = join(
  process.cwd(),
  'docs/06-data-interface/migrations/001_initial_schema.sql',
);

const mockStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf-8'),
};

const VALID_CONTENT = [
  '{"schema_version":"1.0","id":"pre-000001","text":"这波操作真的秀，直接起飞","semantic_type":"funny_joke","description":"玩笑","enabled":true,"is_bad_case":false}',
].join('\n');

function snap(
  contentType: AppendSnapshotInput['contentType'],
  role: AppendSnapshotInput['role'],
  payload: unknown,
): AppendSnapshotInput {
  return { snapshotId: uuidv7(), contentType, role, plaintext: Buffer.from(JSON.stringify(payload)) };
}

const binary = resolveQdrantBinary();
const active: TestQdrant[] = [];

afterEach(async () => {
  for (const qdrant of active.splice(0)) {
    await qdrant.stop();
  }
});

(binary ? describe : describe.skip)('golden sync worker integration (M7-02/03)', () => {
  let testDir: string;
  let worker: AuditStoreWorker;
  let keyManager: CryptoKeyManager;
  let client: QdrantClient;
  let goldenSync: GoldenSyncWorker;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-reflux-'));
    const credStore = new CredentialStore(testDir, mockStorage);
    keyManager = new CryptoKeyManager(credStore);
    await keyManager.ensureKeys('v1');
    worker = new AuditStoreWorker({
      dbPath: join(testDir, 'audit.sqlite'),
      migrations: [{ version: 1, path: MIGRATION_PATH }],
      keyManager,
      keyVersion: 'v1',
    });
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });
    await bootstrapPreSet(client, { content: VALID_CONTENT });
    goldenSync = new GoldenSyncWorker({ audit: worker, qdrantClient: client });
  });

  afterEach(async () => {
    worker.close();
    await rm(testDir, { recursive: true, force: true });
  });

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

  function setupDisplayedTrace(personaVersion: string): string {
    const traceId = uuidv7();
    const sessionId = uuidv7();
    const now = new Date().toISOString();
    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    worker.createTrace({ traceId, sessionId, sourceMessageId: `msg-${traceId}`, receivedAt: now });
    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED', [
      snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', {
        sourceMessageId: `msg-${traceId}`,
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
        personaId: 'p-1', personaVersion, content: '你是主播。', contentHmac: 'hmac-v1',
      }),
    ]);
    worker.appendTransition(traceId, 'ROUTED', 'RETRIEVING', 'RETRIEVAL_STARTED');
    worker.appendTransition(traceId, 'RETRIEVING', 'PROMPT_RENDERED', 'LLM_REQUIRED');
    worker.appendTransition(traceId, 'PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED');
    worker.appendTransition(traceId, 'LLM_PENDING', 'GENERATED', 'PROVIDER_SUCCEEDED', [
      snap('SUGGESTION_JSON', 'LLM_PARSED_OUTPUT', { quickReply: '主播晚上好呀', cues: ['回礼', '问好'] }),
    ]);
    worker.appendTransition(traceId, 'GENERATED', 'DISPLAY_READY', 'OUTPUT_VALIDATED');
    worker.appendTransition(traceId, 'DISPLAY_READY', 'DISPLAYED', 'OVERLAY_RENDERED');
    worker.appendTransition(traceId, 'DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED');
    return traceId;
  }

  function setupDirectTrace(personaVersion: string, pointId: string): string {
    const traceId = uuidv7();
    const sessionId = uuidv7();
    const now = new Date().toISOString();
    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    worker.createTrace({ traceId, sessionId, sourceMessageId: `msg-${traceId}`, receivedAt: now });
    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED', [
      snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', {
        sourceMessageId: `msg-${traceId}`,
        rawText: '今天状态真好',
        normalizedText: '今天状态真好',
        receivedAt: now,
        receivedMonotonicMs: 1,
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
    worker.appendTransition(traceId, 'RETRIEVING', 'DIRECT_READY', 'GOLDEN_DIRECT_ELIGIBLE', [
      snap('SUGGESTION_JSON', 'DIRECT_PAYLOAD', { quick_reply: '谢谢你！', cues: ['接住夸奖', '继续互动'] }),
      snap('DECISION_JSON', 'DIRECT_DECISION', {
        eligible: true, pointId, reason: 'GOLDEN_DIRECT_ELIGIBLE',
      }),
    ]);
    worker.appendTransition(traceId, 'DIRECT_READY', 'DISPLAY_READY', 'OUTPUT_VALIDATED');
    worker.appendTransition(traceId, 'DISPLAY_READY', 'DISPLAYED', 'OVERLAY_RENDERED');
    worker.appendTransition(traceId, 'DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED');
    return traceId;
  }

  it('refluxes an ACCEPTED >=85 label into golden_set and marks the job synced', async () => {
    const { personaVersion } = setupPersonaAndVersion();
    const traceId = setupDisplayedTrace(personaVersion);
    const status = worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 90 });
    expect(status).toBe('ACCEPTED');

    const result = await goldenSync.processPending();
    expect(result.succeeded).toBe(1);

    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    let targetPointId: string;
    try {
      const fb = reader.prepare(
        `SELECT sync_status, target_point_id FROM suggestion_feedback WHERE trace_id = ?`,
      ).get(traceId) as { sync_status: string; target_point_id: string };
      expect(fb.sync_status).toBe('SYNCED');
      targetPointId = fb.target_point_id;
      expect(targetPointId).toBeTruthy();
      const job = reader.prepare(
        `SELECT state FROM qdrant_sync_job WHERE feedback_id = (SELECT current_feedback_id FROM audit_trace WHERE trace_id = ?)`,
      ).get(traceId) as { state: string };
      expect(job.state).toBe('SUCCEEDED');
    } finally {
      reader.close();
    }

    const points = await client.retrieve('golden_set', {
      ids: [targetPointId],
      with_payload: true,
    });
    expect(points).toHaveLength(1);
    const payload = points[0].payload as Record<string, unknown>;
    expect(payload.source_trace_id).toBe(traceId);
    expect(payload.persona_id).toBe('p-1');
    expect(payload.persona_version).toBe(personaVersion);
    expect(payload.reply).toBe('主播晚上好呀');
    expect(payload.cues).toEqual(['回礼', '问好']);
    expect(payload.enabled).toBe(true);
    expect(payload.is_bad_case).toBe(false);
    expect(payload.quality_score).toBe(90);
  }, 30_000);

  it('upserted golden point is retrievable with the current persona filter', async () => {
    const { personaVersion } = setupPersonaAndVersion();
    const traceId = setupDisplayedTrace(personaVersion);
    worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 90 });
    await goldenSync.processPending();

    const retriever = new SuggestionRetriever(client);
    const raw = await retriever.search({
      queryText: '主播晚上好',
      personaId: 'p-1',
      personaVersion,
      topK: 5,
    });
    expect(raw.goldenHits.length).toBeGreaterThan(0);
    const hit = raw.goldenHits[0];
    expect(hit.collection).toBe('golden_set');
    expect((hit.payload as { source_trace_id?: string }).source_trace_id).toBe(traceId);
  }, 30_000);

  it('is idempotent: a second sweep claims nothing and keeps a single point', async () => {
    const { personaVersion } = setupPersonaAndVersion();
    const traceId = setupDisplayedTrace(personaVersion);
    worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 90 });

    const first = await goldenSync.processPending();
    expect(first.succeeded).toBe(1);
    const second = await goldenSync.processPending();
    expect(second.claimed).toBe(0);

    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    let targetPointId: string;
    try {
      targetPointId = (reader.prepare(
        `SELECT target_point_id FROM suggestion_feedback WHERE trace_id = ?`,
      ).get(traceId) as { target_point_id: string }).target_point_id;
    } finally {
      reader.close();
    }
    const points = await client.retrieve('golden_set', { ids: [targetPointId], with_payload: true });
    expect(points).toHaveLength(1);
  }, 30_000);

  it('keeps PENDING jobs untouched when Qdrant is unreachable', async () => {
    const { personaVersion } = setupPersonaAndVersion();
    const traceId = setupDisplayedTrace(personaVersion);
    worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 90 });

    // A client pointed at a closed port makes getCollection fail.
    const deadClient = new QdrantClient({ host: '127.0.0.1', port: 1 });
    const deadSync = new GoldenSyncWorker({ audit: worker, qdrantClient: deadClient });
    const result = await deadSync.processPending();
    expect(result.claimed).toBe(0);

    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    try {
      const job = reader.prepare(
        `SELECT state, attempts FROM qdrant_sync_job`,
      ).get() as { state: string; attempts: number };
      expect(job.state).toBe('PENDING');
      expect(job.attempts).toBe(0);
    } finally {
      reader.close();
    }
  }, 30_000);

  it('marks a rejected golden direct point as a bad case and excludes it from retrieval (M7-03)', async () => {
    const { personaVersion } = setupPersonaAndVersion();

    // Pre-seed the golden point the direct trace pushes from.
    const profile = readGoldenProfile(await client.getCollection('golden_set'));
    const pipeline = createBm25TextPipeline();
    const golden: GoldenSetPayloadV1 = {
      case_id: 'seeded-1',
      tokenizer_version: 'zh_jieba_search_v1',
      source_trace_id: uuidv7(),
      persona_id: 'p-1',
      persona_version: personaVersion,
      text: '今天状态真好',
      semantic_type: 'positive_praise',
      reply: '谢谢你！',
      cues: ['接住夸奖', '继续互动'],
      quality_score: 90,
      enabled: true,
      is_bad_case: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const pointId = uuidv5(`echocue:golden_set:${golden.case_id}`);
    const analyzed = pipeline.analyze(golden.text);
    const vector = buildDocumentVector(analyzed, profile);
    await client.upsert('golden_set', {
      wait: true,
      points: [{
        id: pointId,
        vector: { bm25_zh_jieba_v1: { indices: vector.indices, values: vector.values } },
        payload: golden,
      }],
    });

    const traceId = setupDirectTrace(personaVersion, pointId);
    const status = worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 0 });
    expect(status).toBe('REJECTED');

    const result = await goldenSync.processPending();
    expect(result.succeeded).toBe(1);

    const points = await client.retrieve('golden_set', { ids: [pointId], with_payload: true });
    expect(points).toHaveLength(1);
    const payload = points[0].payload as Record<string, unknown>;
    expect(payload.is_bad_case).toBe(true);
    expect(payload.updated_at).toBeTruthy();

    // The bad point is excluded by the golden filter and no longer retrievable.
    const retriever = new SuggestionRetriever(client);
    const raw = await retriever.search({
      queryText: '今天状态真好',
      personaId: 'p-1',
      personaVersion,
      topK: 5,
    });
    expect(raw.goldenHits).toEqual([]);
  }, 30_000);

  it('recovers through the full outbox loop: fail → re-arm → retry → synced (IMP-4)', async () => {
    const { personaVersion } = setupPersonaAndVersion();
    const traceId = setupDisplayedTrace(personaVersion);
    worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 90 });

    // Controlled mock Qdrant: reachable with a valid profile, but the first
    // upsert fails (transient) and the second succeeds.
    let currentMs = Date.now();
    const clientMock = {
      getCollection: vi.fn(async () => ({
        config: { metadata: { bm25_k1: 1.2, bm25_b: 0.75, avg_doc_len_baseline: 4 } },
      })),
      upsert: vi.fn()
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValueOnce({ status: 'ok' }),
      setPayload: vi.fn(),
    };
    const sync = new GoldenSyncWorker({
      audit: worker,
      qdrantClient: clientMock as never,
      retryBaseMs: 100,
      now: () => new Date(currentMs),
    });

    const first = await sync.processPending();
    expect(first.failed).toBe(1);

    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    let jobId: string;
    try {
      const row = reader.prepare(
        `SELECT job_id, state, attempts FROM qdrant_sync_job`,
      ).get() as { job_id: string; state: string; attempts: number };
      expect(row.state).toBe('FAILED');
      expect(row.attempts).toBe(1);
      jobId = row.job_id;
    } finally {
      reader.close();
    }

    // Advance past the backoff so the next sweep re-arms and retries.
    currentMs += 500;
    const second = await sync.processPending();
    expect(second.rearmed).toBe(1);
    expect(second.succeeded).toBe(1);

    const reader2 = new DatabaseSync(join(testDir, 'audit.sqlite'));
    try {
      const job = reader2.prepare(
        `SELECT state FROM qdrant_sync_job WHERE job_id = ?`,
      ).get(jobId) as { state: string };
      expect(job.state).toBe('SUCCEEDED');
      const fb = reader2.prepare(
        `SELECT sync_status, target_point_id FROM suggestion_feedback WHERE trace_id = ?`,
      ).get(traceId) as { sync_status: string; target_point_id: string };
      expect(fb.sync_status).toBe('SYNCED');
      expect(fb.target_point_id).toBeTruthy();
    } finally {
      reader2.close();
    }
  }, 30_000);
});
