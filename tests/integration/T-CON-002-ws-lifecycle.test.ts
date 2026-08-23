import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { WebSocketServer, type WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceLifecycle } from '@echocue/contracts';
import { uuidv7 } from '../../src/main/util/index.js';
import {
  ServiceController,
  ServiceStateMachine,
  type ServiceGateChecks,
} from '../../src/main/service/index.js';
import { DouyinLiveWsAdapter } from '../../src/main/douyin/index.js';
import { AuditStoreWorker } from '../../src/main/storage/index.js';
import { CryptoKeyManager } from '../../src/main/crypto/index.js';
import { CredentialStore } from '../../src/main/credentials/CredentialStore.js';
import { createTestWebSocketServer } from './ws-test-server.js';

const MIGRATION_PATH = join(
  process.cwd(),
  'docs/06-data-interface/migrations/001_initial_schema.sql',
);

const mockStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf-8'),
};

class NoopSidecar {
  started = false;
  stopCount = 0;
  async start(): Promise<void> {
    this.started = true;
  }
  async stop(): Promise<void> {
    this.started = false;
    this.stopCount += 1;
  }
  async isHealthy(): Promise<boolean> {
    return this.started;
  }
  get pid(): number | null {
    return this.started ? 1 : null;
  }
}

function allPassChecks(): ServiceGateChecks {
  return {
    getSettings: async () => ({ roomReference: 'room-abc', providerCredentialRef: 'deepseek-01-key' }),
    getCredential: async () => 'sk-test',
    isAuditHealthy: async () => true,
    hasPublishedPersona: async () => true,
    hasPublishedSafetyPolicy: async () => true,
    isRetrievalReady: async () => true,
    isStorageReady: async () => true,
  };
}

function waitForClient(wss: WebSocketServer): Promise<WebSocket> {
  return new Promise((resolve) => wss.once('connection', (ws) => resolve(ws)));
}

async function waitForLifecycle(
  machine: ServiceStateMachine,
  lifecycle: ServiceLifecycle,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (machine.getViewState().lifecycle !== lifecycle) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${lifecycle}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('T-CON-002: WebSocket Lifecycle Integration', () => {
  let server: WebSocketServer;
  let serverPort: number;
  let testDir: string;
  let worker: AuditStoreWorker;

  beforeEach(async () => {
    const ws = await createTestWebSocketServer();
    server = ws.server;
    serverPort = ws.port;
    testDir = await mkdtemp(join(tmpdir(), 'echocue-tcon002-'));
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
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    worker.close();
    await rm(testDir, { recursive: true, force: true });
  });

  function makeController(
    createLiveSession?: (params: { roomReference: string; platformRoomId?: string }) => Promise<void>,
    gateTimeoutMs = 5000,
  ) {
    const machine = new ServiceStateMachine();
    const sidecar = new NoopSidecar();
    const controller = new ServiceController({
      stateMachine: machine,
      sidecar,
      createAdapter: (roomReference) =>
        new DouyinLiveWsAdapter({ host: '127.0.0.1', port: serverPort, roomReference }),
      checks: allPassChecks(),
      createLiveSession:
        createLiveSession ??
        (async (params) => {
          worker.createSession({
            sessionId: uuidv7(),
            roomReference: params.roomReference,
            ...(params.platformRoomId !== undefined ? { platformRoomId: params.platformRoomId } : {}),
            startedAt: new Date().toISOString(),
          });
        }),
      cleanupOnStop: () => undefined,
      gateTimeoutMs,
    });
    return { controller, machine, sidecar };
  }

  it('should connect to douyinLive WebSocket', async () => {
    const { controller, machine } = makeController();
    const clientPromise = waitForClient(server);
    const startPromise = controller.start();
    const client = await clientPromise;
    await waitForLifecycle(machine, 'GATE_CONNECTING');
    client.send(
      JSON.stringify({ type: 'system', event: 'live_status', code: 'ROOM_ONLINE', data: { room_id: '123456' } }),
    );
    const state = await startPromise;
    expect(state.lifecycle).toBe('RUNNING');
  });

  it('should transition to RUNNING on ROOM_ONLINE and create a live session', async () => {
    const { controller, machine } = makeController();
    const clientPromise = waitForClient(server);
    const startPromise = controller.start();
    const client = await clientPromise;
    await waitForLifecycle(machine, 'GATE_CONNECTING');
    client.send(
      JSON.stringify({ type: 'system', event: 'live_status', code: 'ROOM_ONLINE', data: { room_id: '123456' } }),
    );
    const state = await startPromise;
    expect(state.lifecycle).toBe('RUNNING');
    expect(state.activity).toBe('LISTENING');
  });

  it('should transition to STOPPED on ROOM_OFFLINE', async () => {
    const { controller, machine, sidecar } = makeController();
    const clientPromise = waitForClient(server);
    const startPromise = controller.start();
    const client = await clientPromise;
    await waitForLifecycle(machine, 'GATE_CONNECTING');
    client.send(JSON.stringify({ type: 'system', event: 'live_status', code: 'ROOM_OFFLINE' }));
    const state = await startPromise;
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.stopReason).toBe('ROOM_OFFLINE');
    expect(sidecar.started).toBe(false);
  });

  it('stays gated and fails closed when ROOM_ONLINE never arrives (M7-04)', async () => {
    const { controller, machine } = makeController(undefined, 200);
    const clientPromise = waitForClient(server);
    const startPromise = controller.start();
    await clientPromise;
    await waitForLifecycle(machine, 'GATE_CONNECTING');
    // No status frame is sent: the gate must time out rather than enter RUNNING.
    const state = await startPromise;
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.stopReason).toBe('SOURCE_ERROR');
    expect(state.recoverableError?.code).toBe('E_SOURCE_UNAVAILABLE');
  });

  it('should transition to STOPPED on ROOM_ENDED (M7-04)', async () => {
    const { controller, machine, sidecar } = makeController();
    const clientPromise = waitForClient(server);
    const startPromise = controller.start();
    const client = await clientPromise;
    await waitForLifecycle(machine, 'GATE_CONNECTING');
    client.send(
      JSON.stringify({ type: 'system', event: 'live_status', code: 'ROOM_ONLINE', data: { room_id: '123456' } }),
    );
    await startPromise;
    expect(machine.getViewState().lifecycle).toBe('RUNNING');
    client.send(JSON.stringify({ type: 'system', event: 'live_status', code: 'ROOM_ENDED' }));
    await waitForLifecycle(machine, 'STOPPED');
    const state = machine.getViewState();
    expect(state.stopReason).toBe('ROOM_ENDED');
    expect(sidecar.started).toBe(false);
  });

  it('should not auto-reconnect after disconnect', async () => {
    const { controller, machine } = makeController();
    const clientPromise = waitForClient(server);
    const startPromise = controller.start();
    await clientPromise;
    await waitForLifecycle(machine, 'GATE_CONNECTING');
    await controller.stop();
    const state = await startPromise;
    expect(state.lifecycle).toBe('STOPPED');
    // no further connections are attempted by the controller
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.clients.size).toBe(0);
  });

  it('should clean up resources on stop', async () => {
    const { controller, machine, sidecar } = makeController();
    const clientPromise = waitForClient(server);
    const startPromise = controller.start();
    const client = await clientPromise;
    await waitForLifecycle(machine, 'GATE_CONNECTING');
    client.send(
      JSON.stringify({ type: 'system', event: 'live_status', code: 'ROOM_ONLINE', data: { room_id: '123456' } }),
    );
    await startPromise;
    await controller.stop();
    expect(sidecar.stopCount).toBe(1);
    expect(sidecar.started).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.clients.size).toBe(0);
  });

  it('should stop with AUDIT_UNAVAILABLE when the session write fails on ROOM_ONLINE', async () => {
    const { controller, machine } = makeController(async () => {
      throw new Error('audit db unavailable');
    });
    const clientPromise = waitForClient(server);
    const startPromise = controller.start();
    const client = await clientPromise;
    await waitForLifecycle(machine, 'GATE_CONNECTING');
    client.send(
      JSON.stringify({ type: 'system', event: 'live_status', code: 'ROOM_ONLINE', data: { room_id: '123456' } }),
    );
    const state = await startPromise;
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.stopReason).toBe('AUDIT_UNAVAILABLE');
  });
});
