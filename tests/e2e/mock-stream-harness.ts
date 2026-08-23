import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseSync } from 'node:sqlite';
import type { WebSocketServer, WebSocket } from 'ws';
import { createTestWebSocketServer } from '../integration/ws-test-server.js';
import type {
  AuditWorkflowV1,
  OverlayDisplayPayloadV1,
  ServiceLifecycle,
  ServiceViewState,
  TraceReasonCodeV1,
  TraceState,
} from '@echocue/contracts';
import { AuditStoreWorker } from '../../src/main/storage/index.js';
import { CryptoKeyManager } from '../../src/main/crypto/key-manager.js';
import { CredentialStore } from '../../src/main/credentials/CredentialStore.js';
import { ServiceController, ServiceStateMachine } from '../../src/main/service/index.js';
import { DouyinLiveWsAdapter } from '../../src/main/douyin/index.js';
import { SuggestionAttemptOrchestrator } from '../../src/main/suggestion/index.js';
import { SuggestionOutputValidator } from '../../src/main/validation/index.js';
import type { RetrievalRawHit } from '../../src/main/retrieval/index.js';
import type { CompiledSafetyRuleV1 } from '../../src/main/safety/index.js';
import type { TextGenerationProvider } from '../../src/main/provider/index.js';
import { uuidv7 } from '../../src/main/util/index.js';

const MIGRATION_PATH = join(
  process.cwd(),
  'docs/06-data-interface/migrations/001_initial_schema.sql',
);

const mockStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf-8'),
};

/** Trace step as a comparable tuple; null marks the chain head. */
export type TraceStep = [TraceState | null, TraceState, TraceReasonCodeV1];

export function transitionTuples(workflow: AuditWorkflowV1): TraceStep[] {
  return workflow.transitions.map((t) => [t.fromState, t.toState, t.reasonCode]);
}

const TERMINAL_STATES = new Set<TraceState>(['FILTERED', 'DISCARDED', 'HIDDEN', 'FAILED']);

/** Poll until the trace reaches a terminal state, then return its workflow. */
export async function waitForTerminal(
  worker: AuditStoreWorker,
  traceId: string,
  timeoutMs = 8000,
): Promise<AuditWorkflowV1> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const workflow = worker.getTraceWorkflowV1(traceId);
    const last = workflow?.transitions.at(-1)?.toState;
    if (last !== undefined && TERMINAL_STATES.has(last)) return workflow!;
    if (Date.now() > deadline) {
      throw new Error(
        `trace ${traceId} did not reach a terminal state within ${timeoutMs}ms (last=${String(last)})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export interface MockStreamHarnessOptions {
  hits?: RetrievalRawHit[];
  compiledRules?: CompiledSafetyRuleV1[] | null;
  providerDelayMs?: number;
  windowMaxAgeMs?: number;
  displayDurationMs?: number;
  gateTimeoutMs?: number;
}

export interface DisplayedRecord {
  payload: OverlayDisplayPayloadV1;
  meta: { sessionId: string; traceId: string; windowVersion: number };
}

export interface MockStreamHarness {
  controller: ServiceController;
  orchestrator: SuggestionAttemptOrchestrator;
  worker: AuditStoreWorker;
  machine: ServiceStateMachine;
  sidecar: { started: boolean; stopCount: number };
  server: WebSocketServer;
  serverPort: number;
  auditDbPath: string;
  sessionId: string;
  shown: DisplayedRecord[];
  providerCalls: { count: number };
  startService(): Promise<ServiceViewState>;
  sendFrame(frame: unknown): void;
  sendComment(content: string, msgId: string, nickname?: string): void;
  sendStatus(code: string, data?: Record<string, unknown>): void;
  traceIds(): Array<{ traceId: string; receivedAt: string }>;
  stop(reason?: 'USER_STOP' | 'ROOM_ENDED' | 'ROOM_OFFLINE' | 'SOURCE_ERROR' | 'AUDIT_UNAVAILABLE'): Promise<ServiceViewState>;
  close(): Promise<void>;
}

function stopReasonToCancelReason(
  reason: NonNullable<ServiceViewState['stopReason']>,
): 'USER_STOPPED' | 'ROOM_ENDED' | 'AUDIT_FAILURE' | 'SOURCE_ERROR' {
  switch (reason) {
    case 'USER_STOP':
      return 'USER_STOPPED';
    case 'ROOM_ENDED':
      return 'ROOM_ENDED';
    case 'AUDIT_UNAVAILABLE':
      return 'AUDIT_FAILURE';
    case 'ROOM_OFFLINE':
    case 'SOURCE_ERROR':
      return 'SOURCE_ERROR';
  }
}

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

export async function buildMockStreamHarness(
  options: MockStreamHarnessOptions = {},
): Promise<MockStreamHarness> {
  const testDir = await mkdtemp(join(tmpdir(), 'echocue-mockstream-'));
  const auditDbPath = join(testDir, 'audit.sqlite');
  const credStore = new CredentialStore(testDir, mockStorage);
  const keyManager = new CryptoKeyManager(credStore);
  await keyManager.ensureKeys('v1');
  const worker = new AuditStoreWorker({
    dbPath: auditDbPath,
    migrations: [{ version: 1, path: MIGRATION_PATH }],
    keyManager,
    keyVersion: 'v1',
  });

  const machine = new ServiceStateMachine();
  const sidecar = new NoopSidecar();
  const { server, port: serverPort } = await createTestWebSocketServer();

  const shown: DisplayedRecord[] = [];
  const providerCalls = { count: 0 };

  const orchestrator = new SuggestionAttemptOrchestrator({
    audit: worker,
    stateMachine: machine,
    router: {
      route: () => ({
        personaId: 'p-1',
        personaVersion: 'v-1',
        personaMarkdown: '你是一个温柔、爱笑的直播出镜人员。',
        decision: 'principal_fallback',
        candidates: [],
      }),
    },
    personas: {
      listPersonas: () => [{ personaId: 'p-1', displayName: '主播A', isPrincipal: true }],
      listAliases: () => [],
      getVersionMeta: () => ({ contentHmac: 'hmac-v1' }),
    },
    safety: {
      getActivePublishedVersion: async () => 'pol-v1',
      readPolicy: () => ({
        policyText: '禁止私聊与禁忌话题。',
        keywords: [],
        compiledRules: options.compiledRules ?? [],
        validationErrors: null,
      }),
    },
    retriever: {
      search: async () => ({
        goldenHits: (options.hits ?? []).filter((h) => h.collection === 'golden_set'),
        preHits: (options.hits ?? []).filter((h) => h.collection === 'pre_set'),
      }),
    },
    providerConfig: {
      getProviderConfig: async () => ({
        providerId: 'compat-backup',
        displayName: '备用',
        adapterType: 'OPENAI_COMPATIBLE',
        baseUrl: 'https://llm.example.invalid/v1',
        modelId: 'm',
        credentialRef: 'safe-storage:compat-backup',
      }),
    },
    credentials: { getCredential: async () => 'sk-test' },
    createProvider: (): TextGenerationProvider => ({
      adapterType: 'OPENAI_COMPATIBLE',
      async generateReply(input) {
        providerCalls.count += 1;
        if ((options.providerDelayMs ?? 0) > 0) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, options.providerDelayMs);
            timer.unref?.();
            input.abortSignal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
        }
        return { ok: true, output: { quick_reply: '谢谢你', cues: ['一', '二'] } };
      },
      getAuditRecord: () => null,
    }),
    validator: new SuggestionOutputValidator(),
    displaySink: {
      async show(payload, meta) {
        shown.push({ payload, meta });
        return { ok: true, firstFrameAtMonotonicMs: performance.now() };
      },
      async hide() {
        // nothing to hide
      },
    },
    nowMonotonic: () => performance.now(),
    windowMaxAgeMs: options.windowMaxAgeMs ?? 5000,
    candidateMaxCount: 50,
    directPushThreshold: 0.85,
    displayDurationMs: options.displayDurationMs ?? 5000,
    onAuditFailure: () => {
      void controller.stop('AUDIT_UNAVAILABLE');
    },
  });

  let sessionId = '';
  const controller = new ServiceController({
    stateMachine: machine,
    sidecar,
    createAdapter: (roomReference) =>
      new DouyinLiveWsAdapter({ host: '127.0.0.1', port: serverPort, roomReference }),
    checks: {
      getSettings: async () => ({
        roomReference: 'room-abc',
        providerCredentialRef: 'safe-storage:compat-backup',
      }),
      getCredential: async () => 'sk-test',
      isAuditHealthy: async () => true,
      hasPublishedPersona: async () => true,
      hasPublishedSafetyPolicy: async () => true,
      isRetrievalReady: async () => true,
      isStorageReady: async () => true,
    },
    createLiveSession: async (params) => {
      sessionId = uuidv7();
      worker.createSession({
        sessionId,
        roomReference: params.roomReference,
        ...(params.platformRoomId !== undefined ? { platformRoomId: params.platformRoomId } : {}),
        startedAt: new Date().toISOString(),
      });
      await orchestrator.startSession({ sessionId });
      return sessionId;
    },
    onComment: (comment) => orchestrator.handleComment(comment),
    cleanupOnStop: (reason) => {
      orchestrator.abortAll(stopReasonToCancelReason(reason));
      orchestrator.endSession();
    },
    gateTimeoutMs: options.gateTimeoutMs ?? 5000,
  });

  let client: WebSocket | null = null;
  server.on('connection', (ws) => {
    client = ws;
  });

  async function waitForLifecycle(lifecycle: ServiceLifecycle, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (machine.getViewState().lifecycle !== lifecycle) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${lifecycle}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  const harness: MockStreamHarness = {
    controller,
    orchestrator,
    worker,
    machine,
    sidecar,
    server,
    serverPort,
    auditDbPath,
    sessionId: '',
    shown,
    providerCalls,
    async startService() {
      const clientPromise = new Promise<WebSocket>((resolve) => server.once('connection', resolve));
      const startPromise = controller.start();
      client = await clientPromise;
      await waitForLifecycle('GATE_CONNECTING');
      client.send(
        JSON.stringify({
          type: 'system',
          event: 'live_status',
          code: 'ROOM_ONLINE',
          data: { room_id: '123456' },
        }),
      );
      const state = await startPromise;
      if (state.lifecycle !== 'RUNNING') {
        throw new Error(`service did not reach RUNNING: ${JSON.stringify(state)}`);
      }
      harness.sessionId = sessionId;
      return state;
    },
    sendFrame(frame) {
      if (client === null) throw new Error('no connected client; call startService() first');
      client.send(JSON.stringify(frame));
    },
    sendComment(content, msgId, nickname = '观众A') {
      this.sendFrame({
        method: 'WebcastChatMessage',
        content,
        common: { msgId, createTime: Date.now() },
        user: { nickName: nickname },
      });
    },
    sendStatus(code, data) {
      this.sendFrame({ type: 'system', event: 'live_status', code, data });
    },
    traceIds() {
      const db = new DatabaseSync(auditDbPath);
      try {
        return db
          .prepare(
            'SELECT trace_id as traceId, received_at as receivedAt FROM audit_trace WHERE session_id = ? ORDER BY rowid',
          )
          .all(sessionId) as Array<{ traceId: string; receivedAt: string }>;
      } finally {
        db.close();
      }
    },
    async stop(reason = 'USER_STOP') {
      return controller.stop(reason);
    },
    async close() {
      try {
        const lifecycle = machine.getViewState().lifecycle;
        if (lifecycle === 'RUNNING' || lifecycle === 'GATE_CONNECTING') await controller.stop();
      } catch {
        // already stopped
      }
      try {
        worker.close();
      } catch {
        // already closed by the audit-failure scenario
      }
      client?.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(testDir, { recursive: true, force: true });
    },
  };
  return harness;
}
