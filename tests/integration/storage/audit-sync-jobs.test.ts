import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  AuditStoreWorker,
  type AppendSnapshotInput,
} from '../../../src/main/storage/index.js';
import { PersonaStore } from '../../../src/main/persona/index.js';
import { CryptoKeyManager } from '../../../src/main/crypto/key-manager.js';
import { CredentialStore } from '../../../src/main/credentials/CredentialStore.js';

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

describe('T-AUD-001: qdrant_sync_job lifecycle (M7-01)', () => {
  let testDir: string;
  let worker: AuditStoreWorker;
  let keyManager: CryptoKeyManager;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-syncjobs-'));
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

  // A fully displayed trace the label form can act on (mirrors T-AUD-001).
  function setupDisplayedTrace(
    personaVersion: string,
    opts: { goldenDirect?: { pointId: string } } = {},
  ): string {
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const traceId = randomUUID();
    const msg = `msg-${traceId}`;
    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    worker.createTrace({ traceId, sessionId, sourceMessageId: msg, receivedAt: now });
    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED', [
      snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', {
        sourceMessageId: msg, rawText: '主播晚上好', normalizedText: '主播晚上好',
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
    if (opts.goldenDirect !== undefined) {
      worker.appendTransition(traceId, 'RETRIEVING', 'DIRECT_READY', 'GOLDEN_DIRECT_ELIGIBLE', [
        snap('SUGGESTION_JSON', 'DIRECT_PAYLOAD', { quick_reply: '谢谢你', cues: ['一', '二'] }),
        snap('DECISION_JSON', 'DIRECT_DECISION', {
          eligible: true, pointId: opts.goldenDirect.pointId, reason: 'GOLDEN_DIRECT_ELIGIBLE',
        }),
      ]);
      worker.appendTransition(traceId, 'DIRECT_READY', 'DISPLAY_READY', 'OUTPUT_VALIDATED');
    } else {
      worker.appendTransition(traceId, 'RETRIEVING', 'PROMPT_RENDERED', 'LLM_REQUIRED');
      worker.appendTransition(traceId, 'PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED');
      worker.appendTransition(traceId, 'LLM_PENDING', 'GENERATED', 'PROVIDER_SUCCEEDED');
      worker.appendTransition(traceId, 'GENERATED', 'DISPLAY_READY', 'OUTPUT_VALIDATED');
    }
    worker.appendTransition(traceId, 'DISPLAY_READY', 'DISPLAYED', 'OVERLAY_RENDERED');
    worker.appendTransition(traceId, 'DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED');
    return traceId;
  }

  function readJobs(): Array<Record<string, unknown>> {
    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    try {
      return reader.prepare(
        `SELECT job_id, feedback_id, action, state, attempts, last_error, idempotency_key
         FROM qdrant_sync_job`,
      ).all() as Array<Record<string, unknown>>;
    } finally {
      reader.close();
    }
  }

  function readFeedback(feedbackId: string): Record<string, unknown> | undefined {
    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    try {
      return reader.prepare(
        `SELECT sync_status, target_point_id FROM suggestion_feedback WHERE feedback_id = ?`,
      ).get(feedbackId) as Record<string, unknown> | undefined;
    } finally {
      reader.close();
    }
  }

  it('claims a PENDING job exactly once', () => {
    const { personaVersion } = setupPersonaAndVersion();
    const traceId = setupDisplayedTrace(personaVersion);
    worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 90 });

    const claimed = worker.claimNextSyncJob();
    expect(claimed).not.toBeNull();
    expect(claimed!.action).toBe('UPSERT');
    expect(worker.claimNextSyncJob()).toBeNull();
    const jobs = readJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].state).toBe('RUNNING');
  });

  it('re-arms FAILED jobs and their feedback after backoff', () => {
    const { personaVersion } = setupPersonaAndVersion();
    const traceId = setupDisplayedTrace(personaVersion);
    worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 90 });
    const claimed = worker.claimNextSyncJob()!;
    worker.failSyncJob(claimed.jobId, claimed.feedbackId, 'qdrant timeout');

    // Not eligible until the worker's backoff filter runs; a direct re-arm works.
    expect(worker.rearmEligibleSyncJobs([claimed.jobId])).toBe(1);
    expect(worker.rearmEligibleSyncJobs([claimed.jobId])).toBe(0);
    const job = readJobs()[0];
    expect(job.state).toBe('PENDING');
    expect(readFeedback(claimed.feedbackId)?.sync_status).toBe('PENDING');
  });

  it('completes a RUNNING job with the target point id and rejects a double-complete', () => {
    const { personaVersion } = setupPersonaAndVersion();
    const traceId = setupDisplayedTrace(personaVersion);
    worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 90 });
    const claimed = worker.claimNextSyncJob()!;

    worker.completeSyncJob(claimed.jobId, claimed.feedbackId, 'point-golden-1');
    const job = readJobs()[0];
    expect(job.state).toBe('SUCCEEDED');
    expect(job.last_error).toBeNull();
    expect(readFeedback(claimed.feedbackId)?.sync_status).toBe('SYNCED');
    expect(readFeedback(claimed.feedbackId)?.target_point_id).toBe('point-golden-1');

    expect(() => worker.completeSyncJob(claimed.jobId, claimed.feedbackId, 'point-golden-1')).toThrow(
      /not RUNNING/,
    );
  });

  it('fails a RUNNING job with attempts+1 and permanent failure caps retries', () => {
    const { personaVersion } = setupPersonaAndVersion();
    const traceId = setupDisplayedTrace(personaVersion);
    worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 90 });
    const claimed = worker.claimNextSyncJob()!;
    worker.failSyncJob(claimed.jobId, claimed.feedbackId, 'upsert failed');

    let job = readJobs()[0];
    expect(job.state).toBe('FAILED');
    expect(job.attempts).toBe(1);
    expect(job.last_error).toBe('upsert failed');
    expect(readFeedback(claimed.feedbackId)?.sync_status).toBe('FAILED');

    // A second failure attempt on the same (non-RUNNING) job is rejected.
    expect(() => worker.failSyncJob(claimed.jobId, claimed.feedbackId, 'again')).toThrow(/not RUNNING/);

    // Permanent data errors are not auto-rearmed (attempts capped).
    const traceId2 = setupDisplayedTrace(personaVersion);
    worker.submitLabel({ traceId: traceId2, expectedRevisionNo: 0, score: 90 });
    const claimed2 = worker.claimNextSyncJob()!;
    worker.failSyncJob(claimed2.jobId, claimed2.feedbackId, 'missing suggestion snapshot', true);
    job = readJobs()[1];
    expect(job.state).toBe('FAILED');
    expect(Number(job.attempts)).toBeGreaterThan(1_000_000);
  });

  it('resets stale RUNNING jobs on startup recovery', () => {
    const { personaVersion } = setupPersonaAndVersion();
    const traceId = setupDisplayedTrace(personaVersion);
    worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 90 });
    worker.claimNextSyncJob();
    expect(readJobs()[0].state).toBe('RUNNING');

    expect(worker.resetStaleRunningJobs()).toBe(1);
    expect(readJobs()[0].state).toBe('PENDING');
    expect(worker.resetStaleRunningJobs()).toBe(0);
  });

  it('enforces the UNIQUE idempotency key (no duplicate jobs)', () => {
    const { personaVersion } = setupPersonaAndVersion();
    const traceId = setupDisplayedTrace(personaVersion);
    worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 90 });
    const job = readJobs()[0];

    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    try {
      expect(() => reader.prepare(
        `INSERT INTO qdrant_sync_job
           (job_id, feedback_id, target_collection, action, idempotency_key, state, attempts, created_at, updated_at)
         VALUES (?, ?, 'golden_set', 'UPSERT', ?, 'PENDING', 0, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`,
      ).run(randomUUID(), job.feedback_id, job.idempotency_key)).toThrow();
    } finally {
      reader.close();
    }
  });

  it('rejects an illegal SET_BAD_CASE job via the migration trigger', () => {
    const { personaVersion } = setupPersonaAndVersion();
    // LLM-path rejection: no golden direct source → no job, is_bad_case stays 0.
    const traceId = setupDisplayedTrace(personaVersion);
    worker.submitLabel({ traceId, expectedRevisionNo: 0, score: 0 });
    expect(readJobs()).toHaveLength(0);

    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    try {
      const fb = reader.prepare(
        `SELECT feedback_id FROM suggestion_feedback WHERE trace_id = ?`,
      ).get(traceId) as { feedback_id: string };
      expect(() => reader.prepare(
        `INSERT INTO qdrant_sync_job
           (job_id, feedback_id, target_collection, action, idempotency_key, state, attempts, created_at, updated_at)
         VALUES (?, ?, 'golden_set', 'SET_BAD_CASE', ?, 'PENDING', 0, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`,
      ).run(randomUUID(), fb.feedback_id, `illegal:${randomUUID()}`)).toThrow(/invalid golden bad-case job/);
    } finally {
      reader.close();
    }
  });

  it('emits UPSERT (never SET_BAD_CASE) for a corrected golden-direct label', () => {
    const { personaVersion } = setupPersonaAndVersion();
    const traceId = setupDisplayedTrace(personaVersion, { goldenDirect: { pointId: 'golden-1' } });
    worker.submitLabel({
      traceId,
      expectedRevisionNo: 0,
      score: 85,
      correctedQuickReply: '更优答案',
      correctedCues: ['引导互动', '感谢支持'],
    });
    const jobs = readJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].action).toBe('UPSERT');
  });
});
