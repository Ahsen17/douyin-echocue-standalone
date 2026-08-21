import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'node:crypto';
import {
  AuditStoreWorker,
  AuditStateInvalidError,
  AuditUnavailableError,
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

describe('AuditStoreWorker', () => {
  let testDir: string;
  let worker: AuditStoreWorker;
  let keyManager: CryptoKeyManager;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-audit-test-'));
    const dbPath = join(testDir, 'audit.sqlite');
    const credStore = new CredentialStore(testDir, mockStorage);
    keyManager = new CryptoKeyManager(credStore);
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

  it('creates session and trace', () => {
    const sessionId = randomUUID();
    const traceId = randomUUID();
    const now = new Date().toISOString();

    worker.createSession({
      sessionId,
      roomReference: 'test-room',
      startedAt: now,
    });

    worker.createTrace({
      traceId,
      sessionId,
      sourceMessageId: 'msg-1',
      receivedAt: now,
    });
  });

  it('appends valid RECEIVED -> NORMALIZED transition', () => {
    const sessionId = randomUUID();
    const traceId = randomUUID();
    const now = new Date().toISOString();

    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-1', receivedAt: now });

    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED');
    worker.appendTransition(traceId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
  });

  it('builds HMAC chain correctly', () => {
    const sessionId = randomUUID();
    const traceId = randomUUID();
    const now = new Date().toISOString();

    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-1', receivedAt: now });

    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED');
    worker.appendTransition(traceId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
    worker.appendTransition(traceId, 'NORMALIZED', 'FILTERED', 'INPUT_SAFETY_FILTERED');

    // Directly query the HMAC chain from the DB to validate
    const transitions = (worker as any).db.prepare(
      'SELECT sequence_no, previous_hmac, entry_hmac FROM audit_transition WHERE trace_id=? ORDER BY sequence_no',
    ).all(traceId) as Array<{ sequence_no: number; previous_hmac: string | null; entry_hmac: string }>;

    expect(transitions).toHaveLength(3);
    expect(transitions[0].previous_hmac).toBeNull();
    expect(transitions[0].entry_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(transitions[1].previous_hmac).toBe(transitions[0].entry_hmac);
    expect(transitions[2].previous_hmac).toBe(transitions[1].entry_hmac);
  });

  it('throws AuditStateInvalidError on invalid transition', () => {
    const sessionId = randomUUID();
    const traceId = randomUUID();
    const now = new Date().toISOString();

    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-1', receivedAt: now });

    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED');

    expect(() => {
      worker.appendTransition(traceId, 'RECEIVED', 'DISPLAYED', 'OVERLAY_RENDERED');
    }).toThrow(AuditStateInvalidError);
  });

  it('updates final_state when reaching terminal state', () => {
    const sessionId = randomUUID();
    const traceId = randomUUID();
    const now = new Date().toISOString();

    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-1', receivedAt: now });

    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED');
    worker.appendTransition(traceId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
    worker.appendTransition(traceId, 'NORMALIZED', 'FILTERED', 'INPUT_SAFETY_FILTERED');

    const trace = (worker as any).db.prepare(
      'SELECT final_state, completed_at FROM audit_trace WHERE trace_id=?',
    ).get(traceId) as { final_state: string; completed_at: string };

    expect(trace.final_state).toBe('FILTERED');
    expect(trace.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('encrypts snapshot and stores reference', () => {
    const sessionId = randomUUID();
    const traceId = randomUUID();
    const snapshotId = randomUUID();
    const now = new Date().toISOString();

    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-1', receivedAt: now });

    const plaintext = Buffer.from(JSON.stringify({ test: 'data' }), 'utf-8');
    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED', [
      {
        snapshotId,
        contentType: 'RAW_EVENT_JSON',
        role: 'RAW_WS_EVENT',
        plaintext,
      },
    ]);

    const snap = (worker as any).db.prepare(
      'SELECT snapshot_id, content_type, envelope, content_hmac FROM audit_snapshot WHERE snapshot_id=?',
    ).get(snapshotId) as { snapshot_id: string; content_type: string; envelope: Buffer; content_hmac: string };

    expect(snap.snapshot_id).toBe(snapshotId);
    expect(snap.content_type).toBe('RAW_EVENT_JSON');
    expect(snap.envelope.length).toBeGreaterThan(0);
    expect(snap.content_hmac).toMatch(/^[0-9a-f]{64}$/);

    const ref = (worker as any).db.prepare(
      'SELECT trace_id, sequence_no, snapshot_id, role FROM audit_reference WHERE snapshot_id=?',
    ).get(snapshotId) as { trace_id: string; sequence_no: number; snapshot_id: string; role: string };

    expect(ref.trace_id).toBe(traceId);
    expect(ref.sequence_no).toBe(1);
    expect(ref.role).toBe('RAW_WS_EVENT');
  });

  it('throws AuditUnavailableError on DB write failure', async () => {
    // Write a corrupt (non-SQLite) file so DatabaseSync throws on open
    const badDbPath = join(testDir, 'corrupt.sqlite');
    await writeFile(badDbPath, 'this is not a sqlite database');

    expect(() => {
      const failWorker = new AuditStoreWorker({
        dbPath: badDbPath,
        migrations: [{ version: 1, path: MIGRATION_PATH }],
        keyManager,
        keyVersion: 'v1',
      });
      failWorker.close();
    }).toThrow(AuditUnavailableError);
  });

  it('handles DISPLAY_WINDOW_ACTIVE path: RECEIVED->NORMALIZED->DISCARDED', () => {
    const sessionId = randomUUID();
    const traceId = randomUUID();
    const now = new Date().toISOString();

    worker.createSession({ sessionId, roomReference: 'room', startedAt: now });
    worker.createTrace({ traceId, sessionId, sourceMessageId: 'msg-1', receivedAt: now });

    worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED');
    worker.appendTransition(traceId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
    worker.appendTransition(traceId, 'NORMALIZED', 'DISCARDED', 'DISPLAY_WINDOW_ACTIVE');

    const trace = (worker as any).db.prepare(
      'SELECT final_state FROM audit_trace WHERE trace_id=?',
    ).get(traceId) as { final_state: string };

    expect(trace.final_state).toBe('DISCARDED');
  });
});
