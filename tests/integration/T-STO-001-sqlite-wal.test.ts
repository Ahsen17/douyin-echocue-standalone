import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'node:crypto';
import type { LiveSourceEvent } from '@echocue/contracts';
import { DatabaseSync } from 'node:sqlite';
import {
  AuditStoreWorker,
  AuditUnavailableError,
  CRITICAL_MIN_BYTES,
  StorageMonitor,
  STARTUP_MIN_BYTES,
} from '../../src/main/storage/index.js';
import { CryptoKeyManager } from '../../src/main/crypto/key-manager.js';
import { CredentialStore } from '../../src/main/credentials/CredentialStore.js';
import {
  ServiceController,
  ServiceStateMachine,
  createServiceGateChecks,
  type ServiceGateChecks,
  type ServiceGateDependencies,
} from '../../src/main/service/index.js';
import type { SettingsStore } from '../../src/main/config/index.js';
import type { PersonaStore } from '../../src/main/persona/index.js';
import type { SafetyPolicyStore } from '../../src/main/safety/index.js';
import type { QdrantSidecarManager } from '../../src/main/qdrant/index.js';
import type { QdrantClient } from '@qdrant/js-client-rest';

const MIGRATION_PATH = join(
  process.cwd(),
  'docs/06-data-interface/migrations/001_initial_schema.sql',
);

const mockStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf-8'),
};

// Empty-DB init, duplicate migration and failed-migration rollback are already
// covered by migration-runner.test.ts; T-STO-001 targets the capacity/WAL/
// integrity/recovery surface (DELIVERY A-12) that migration-runner does not.

async function makeWorker(dir: string): Promise<{
  worker: AuditStoreWorker;
  dbPath: string;
  traceId: string;
}> {
  const dbPath = join(dir, 'audit.sqlite');
  const credStore = new CredentialStore(dir, mockStorage);
  const keyManager = new CryptoKeyManager(credStore);
  await keyManager.ensureKeys('v1');
  const worker = new AuditStoreWorker({
    dbPath,
    migrations: [{ version: 1, path: MIGRATION_PATH }],
    keyManager,
    keyVersion: 'v1',
  });
  const traceId = writeTrace(worker, 'msg-1');
  return { worker, dbPath, traceId };
}

function writeTrace(worker: AuditStoreWorker, msgId: string): string {
  const sessionId = randomUUID();
  const traceId = randomUUID();
  const now = new Date().toISOString();
  worker.createSession({ sessionId, roomReference: 'room-abc', startedAt: now });
  worker.createTrace({ traceId, sessionId, sourceMessageId: msgId, receivedAt: now });
  worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED');
  worker.appendTransition(traceId, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
  return traceId;
}

describe('T-STO-001: SQLite WAL, capacity and recovery', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-sto-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('checkpoints WAL to a zero-length -wal and keeps data readable', async () => {
    const { worker, dbPath, traceId } = await makeWorker(testDir);
    const walPath = `${dbPath}-wal`;
    expect((await stat(walPath)).size).toBeGreaterThan(0);

    worker.checkpoint();

    expect((await stat(walPath)).size).toBe(0);
    const workflow = worker.getTraceWorkflowV1(traceId);
    expect(workflow?.transitions.map((t) => t.toState)).toEqual(['RECEIVED', 'NORMALIZED']);
    worker.close();
  });

  it('reports integrity ok on a healthy DB and rejects a tampered HMAC chain', async () => {
    const { worker, traceId } = await makeWorker(testDir);
    const report = worker.verifyIntegrity();
    expect(report.integrityCheck).toBe('ok');
    expect(report.migrationVersion).toBe(1);
    expect(report.transitionsChecked).toBeGreaterThan(0);

    // Tamper: flip the first entry_hmac to a different hex value.
    const db = (worker as unknown as { db: DatabaseSync }).db;
    const first = db.prepare(
      'SELECT sequence_no FROM audit_transition WHERE trace_id=? ORDER BY sequence_no LIMIT 1',
    ).get(traceId) as { sequence_no: number };
    db.prepare('UPDATE audit_transition SET entry_hmac = ? WHERE trace_id=? AND sequence_no=?').run(
      '0'.repeat(64),
      traceId,
      first.sequence_no,
    );
    expect(() => worker.verifyIntegrity()).toThrow(AuditUnavailableError);
    worker.close();
  });

  it('reports integrity ok on a fresh DB with no transitions (first install path)', async () => {
    const dbPath = join(testDir, 'audit.sqlite');
    const credStore = new CredentialStore(testDir, mockStorage);
    const keyManager = new CryptoKeyManager(credStore);
    await keyManager.ensureKeys('v1');
    const worker = new AuditStoreWorker({
      dbPath,
      migrations: [{ version: 1, path: MIGRATION_PATH }],
      keyManager,
      keyVersion: 'v1',
    });
    const report = worker.verifyIntegrity();
    expect(report.integrityCheck).toBe('ok');
    expect(report.migrationVersion).toBe(1);
    expect(report.transitionsChecked).toBe(0);
    worker.close();
  });

  it('verifies interleaved HMAC chains of multiple traces independently', async () => {
    const { worker } = await makeWorker(testDir);
    const secondTraceId = writeTrace(worker, 'msg-2');
    // One more transition on the second trace so a mid-chain delete is possible.
    worker.appendTransition(secondTraceId, 'NORMALIZED', 'ROUTED', 'PERSONA_ROUTED');
    expect(worker.verifyIntegrity().transitionsChecked).toBeGreaterThan(0);

    // Deleting a middle row of the second trace must break only its chain, and
    // the checker must still report a failure.
    const db = (worker as unknown as { db: DatabaseSync }).db;
    db.prepare('DELETE FROM audit_transition WHERE trace_id=? AND sequence_no=2').run(secondTraceId);
    expect(() => worker.verifyIntegrity()).toThrow(/sequence gap|disconnected/);
    worker.close();
  });

  it('detects a deleted intermediate transition as a broken HMAC chain', async () => {
    const { worker, traceId } = await makeWorker(testDir);
    // makeWorker already wrote RECEIVED→NORMALIZED; add one more transition so
    // a middle row (sequence 2) can be deleted. Deleting it must break the
    // chain even though every surviving entry_hmac recomputes cleanly.
    worker.appendTransition(traceId, 'NORMALIZED', 'ROUTED', 'PERSONA_ROUTED');

    const db = (worker as unknown as { db: DatabaseSync }).db;
    db.prepare('DELETE FROM audit_transition WHERE trace_id=? AND sequence_no=2').run(traceId);

    expect(() => worker.verifyIntegrity()).toThrow(/sequence gap|disconnected/);
    worker.close();
  });

  it('creates a consistent backup and verifies a restored copy', async () => {
    const { worker, dbPath, traceId } = await makeWorker(testDir);
    const backupPath = join(testDir, 'audit-backup.sqlite');

    worker.checkpoint();
    worker.close();
    worker.backupTo(backupPath);

    const backup = new DatabaseSync(backupPath, { readOnly: true });
    const backupCount = backup.prepare('SELECT COUNT(*) as c FROM audit_trace').get() as { c: number };
    expect(backupCount.c).toBe(1);
    const migration = backup
      .prepare('SELECT version FROM schema_migration ORDER BY version DESC LIMIT 1')
      .get() as { version: number };
    expect(migration.version).toBe(1);
    backup.close();

    // Restore: replace the destroyed original from the backup, then reopen.
    await rm(dbPath, { force: true });
    const backupBuf = await (await import('fs/promises')).readFile(backupPath);
    await writeFile(dbPath, backupBuf);

    const restored = await makeWorker(testDir);
    expect(restored.worker.verifyIntegrity().integrityCheck).toBe('ok');
    const workflow = restored.worker.getTraceWorkflowV1(traceId);
    expect(workflow?.transitions.map((t) => t.toState)).toEqual(['RECEIVED', 'NORMALIZED']);
    restored.worker.close();
  });

  it(
    'records growth per 1000 traces for remaining-capacity estimation',
    async () => {
      const dbPath = join(testDir, 'audit.sqlite');
      const credStore = new CredentialStore(testDir, mockStorage);
      const keyManager = new CryptoKeyManager(credStore);
      await keyManager.ensureKeys('v1');
      const worker = new AuditStoreWorker({
        dbPath,
        migrations: [{ version: 1, path: MIGRATION_PATH }],
        keyManager,
        keyVersion: 'v1',
      });

      worker.checkpoint();
      const base = (await stat(dbPath)).size;

      // 500 traces is enough to measure a stable per-thousand figure while
      // staying within the budget under full-suite CPU contention.
      const N = 500;
      for (let i = 0; i < N; i += 1) writeTrace(worker, `msg-${i}`);
      worker.checkpoint();
      const after = (await stat(dbPath)).size;

      const growthBytes = after - base;
      const bytesPerThousand = growthBytes / (N / 1000);
      // Each trace persists a session + trace + 2 transitions + indexes; a
      // positive finite value in a plausible range validates the estimate path.
      expect(growthBytes).toBeGreaterThan(0);
      expect(Number.isFinite(bytesPerThousand)).toBe(true);
      expect(bytesPerThousand).toBeGreaterThan(0);
      expect(bytesPerThousand).toBeLessThan(4 * 1024 * 1024);
      worker.close();
    },
    20_000,
  );

  it('rejects the startup gate when the data volume has < 2 GiB free', async () => {
    const below = createServiceGateChecks(
      makeGateDeps({ availableBytes: STARTUP_MIN_BYTES - 1, totalBytes: 8 * 1024 ** 3 }),
    );
    expect(await below.isStorageReady()).toBe(false);

    const at = createServiceGateChecks(
      makeGateDeps({ availableBytes: STARTUP_MIN_BYTES, totalBytes: 8 * 1024 ** 3 }),
    );
    expect(await at.isStorageReady()).toBe(true);
  });

  it('stops the service with AUDIT_UNAVAILABLE when free space drops below 256 MiB', async () => {
    const machine = new ServiceStateMachine();
    const sidecar = new NoopSidecar();
    const adapter = new FakeAdapter();

    const checks: ServiceGateChecks = {
      getSettings: async () => ({ roomReference: 'room-abc', providerCredentialRef: 'deepseek-01-key' }),
      getCredential: async () => 'sk-test',
      isAuditHealthy: async () => true,
      hasPublishedPersona: async () => true,
      hasPublishedSafetyPolicy: async () => true,
      isRetrievalReady: async () => true,
      isStorageReady: async () => true,
    };

    let controller: ServiceController;
    const monitor = new StorageMonitor({
      readStorage: () => ({
        availableBytes: CRITICAL_MIN_BYTES - 1,
        totalBytes: 8 * 1024 ** 3,
      }),
      onCritical: () => {
        void controller.stop('AUDIT_UNAVAILABLE');
      },
      checkIntervalMs: 20,
    });
    controller = new ServiceController({
      stateMachine: machine,
      sidecar,
      createAdapter: () => adapter,
      checks,
      createLiveSession: async () => undefined,
      cleanupOnStop: () => undefined,
      gateTimeoutMs: 2000,
      storageMonitor: monitor,
    });

    const startPromise = controller.start();
    await waitForLifecycle(machine, 'GATE_CONNECTING');
    adapter.emit(online());
    const started = await startPromise;
    expect(started.lifecycle).toBe('RUNNING');
    // The monitor runs on RUNNING and immediately sees the low volume, so the
    // service stops with E_AUDIT_UNAVAILABLE; nothing is deleted.
    await waitForLifecycle(machine, 'STOPPED');
    expect(controller.getViewState().stopReason).toBe('AUDIT_UNAVAILABLE');
  });

  it('never auto-deletes audit rows on capacity or recovery paths', async () => {
    const { worker } = await makeWorker(testDir);
    const db = (worker as unknown as { db: DatabaseSync }).db;
    const traceCount = () =>
      (db.prepare('SELECT COUNT(*) as c FROM audit_trace').get() as { c: number }).c;
    expect(traceCount()).toBe(1);

    // Critical-threshold check + checkpoint + backup produce no deletes.
    const monitor = new StorageMonitor({
      readStorage: () => ({
        availableBytes: CRITICAL_MIN_BYTES - 1,
        totalBytes: 8 * 1024 ** 3,
      }),
      onCritical: () => undefined,
    });
    monitor.check();
    worker.checkpoint();
    const backupPath = join(testDir, 'backup.sqlite');
    worker.checkpoint();
    worker.close();
    worker.backupTo(backupPath);

    const after = new DatabaseSync(join(testDir, 'audit.sqlite'), { readOnly: true });
    expect((after.prepare('SELECT COUNT(*) as c FROM audit_trace').get() as { c: number }).c).toBe(1);
    after.close();
    expect((await stat(backupPath)).size).toBeGreaterThan(0);
  });
});

function makeGateDeps(storage: { availableBytes: number; totalBytes: number }): ServiceGateDependencies {
  return {
    settings: {} as SettingsStore,
    credentials: {} as CredentialStore,
    audit: {} as AuditStoreWorker,
    persona: {} as PersonaStore,
    safety: {} as SafetyPolicyStore,
    qdrant: {} as QdrantSidecarManager,
    qdrantClient: {} as QdrantClient,
    readStorage: () => storage,
  };
}

type Listener = (event: LiveSourceEvent) => void;

class FakeAdapter {
  private listeners = new Set<Listener>();
  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async connect(): Promise<void> {}
  close(): void {}
  emit(event: LiveSourceEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

class NoopSidecar {
  started = false;
  async start(): Promise<void> {
    this.started = true;
  }
  async stop(): Promise<void> {
    this.started = false;
  }
  async isHealthy(): Promise<boolean> {
    return this.started;
  }
  get pid(): number | null {
    return this.started ? 1 : null;
  }
}

async function waitForLifecycle(
  machine: ServiceStateMachine,
  lifecycle: 'RUNNING' | 'STOPPED',
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (machine.getViewState().lifecycle !== lifecycle) {
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for ${lifecycle} (got ${machine.getViewState().lifecycle})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function online(): LiveSourceEvent {
  return {
    type: 'LIVE_ONLINE',
    roomReference: 'room-abc',
    platformRoomId: '123456',
    receivedAt: '2026-08-23T00:00:00.000Z',
  };
}
