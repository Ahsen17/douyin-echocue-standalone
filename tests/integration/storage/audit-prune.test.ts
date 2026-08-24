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

describe('T-AUD audit retention prune (WP-3)', () => {
  let testDir: string;
  let dbPath: string;
  let worker: AuditStoreWorker;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-prune-'));
    dbPath = join(testDir, 'audit.sqlite');
    const credStore = new CredentialStore(testDir, mockStorage);
    const keyManager = new CryptoKeyManager(credStore);
    await keyManager.ensureKeys('v1');
    worker = new AuditStoreWorker({
      dbPath,
      migrations: [{ version: 1, path: MIGRATION_PATH }],
      keyManager,
      keyVersion: 'v1',
    });
  });

  afterEach(async () => {
    worker.close();
    await rm(testDir, { recursive: true, force: true });
  });

  function traceCount(): number {
    const db = new DatabaseSync(dbPath);
    const row = db.prepare('SELECT COUNT(*) AS c FROM audit_trace').get() as { c: number };
    db.close();
    return row.c;
  }

  it('prunes only completed traces older than the cutoff, cascading snapshots', () => {
    const now = new Date().toISOString();
    worker.createSession({ sessionId: 's1', roomReference: 'room-1', startedAt: now });
    worker.createTrace({ traceId: 't-old', sessionId: 's1', sourceMessageId: 'm-old', receivedAt: '2026-07-01T00:00:00.000Z' });
    worker.appendTransition('t-old', null, 'RECEIVED', 'EVENT_RECEIVED', []);
    worker.appendTransition('t-old', 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK', [
      snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', { normalizedText: 'x' }),
    ]);
    worker.appendTransition('t-old', 'NORMALIZED', 'DISCARDED', 'LOW_VALUE', []);

    worker.createTrace({ traceId: 't-new', sessionId: 's1', sourceMessageId: 'm-new', receivedAt: now });
    worker.appendTransition('t-new', null, 'RECEIVED', 'EVENT_RECEIVED', []);
    worker.appendTransition('t-new', 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK', []);
    worker.appendTransition('t-new', 'NORMALIZED', 'DISCARDED', 'LOW_VALUE', []);

    // In-flight trace: completed_at stays NULL and must survive pruning.
    worker.createTrace({ traceId: 't-flight', sessionId: 's1', sourceMessageId: 'm-flight', receivedAt: now });
    worker.appendTransition('t-flight', null, 'RECEIVED', 'EVENT_RECEIVED', []);

    // Move the old trace's completion into the past.
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE audit_trace SET completed_at = '2026-07-01T00:00:00.000Z' WHERE trace_id = 't-old'").run();
    db.close();

    const result = worker.pruneTracesOlderThan(now);
    expect(result.deletedTraces).toBe(1);
    expect(result.deletedSnapshots).toBe(1);
    expect(traceCount()).toBe(2); // t-new + t-flight
    expect(worker.getTraceWorkflowV1('t-old')).toBeNull();
    // The surviving trace's HMAC chain is still valid after whole-trace deletion.
    expect(worker.verifyIntegrity().integrityCheck).toBe('ok');
  });

  it('is a no-op when nothing is older than the cutoff', () => {
    const now = new Date().toISOString();
    const result = worker.pruneTracesOlderThan(now);
    expect(result.deletedTraces).toBe(0);
    expect(worker.verifyIntegrity().integrityCheck).toBe('ok');
  });
});
