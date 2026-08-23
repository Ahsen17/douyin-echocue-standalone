import { statfsSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceViewState } from '@echocue/contracts';
import { QdrantClient } from '@qdrant/js-client-rest';
import { SettingsStore } from '../config/index.js';
import { CredentialStore, type SafeStorageLike } from '../credentials/index.js';
import { CryptoKeyManager } from '../crypto/index.js';
import { AuditStoreWorker, StorageMonitor, type MigrationFile } from '../storage/index.js';
import { PersonaRouter, PersonaStore } from '../persona/index.js';
import { SafetyPolicyStore } from '../safety/index.js';
import { QDRANT_HTTP_PORT, QDRANT_LOOPBACK_HOST, QdrantSidecarManager } from '../qdrant/index.js';
import { DouyinLiveSidecarManager, DouyinLiveWsAdapter } from '../douyin/index.js';
import { DeepSeekProvider, OpenAiCompatibleProvider, ProviderConfigService } from '../provider/index.js';
import { SuggestionRetriever } from '../retrieval/index.js';
import { GoldenSyncWorker } from '../reflux/index.js';
import { SuggestionOutputValidator } from '../validation/index.js';
import { SuggestionAttemptOrchestrator } from '../suggestion/index.js';
import type { SuggestionDisplaySink } from '../suggestion/index.js';
import type { CancelTraceReason } from '../validation/index.js';
import { DiagnosticsSource } from '../telemetry/index.js';
import { ServiceController } from './ServiceController.js';
import type { ServiceControllerOptions } from './ServiceController.js';
import { createLiveSessionWriter, createServiceGateChecks } from './service-gate.js';
import { ServiceStateMachine } from './ServiceStateMachine.js';

export interface CreateServiceControllerOptions {
  dataDir: string;
  safeStorage: SafeStorageLike;
  douyinLiveBinaryPath: string;
  qdrantBinaryPath: string;
  migrationPath: string;
  keyVersion: string;
  cleanupOnStop: () => void;
  /** Overlay port; M6-07 replaces the default stub with the real window. */
  displaySink?: SuggestionDisplaySink;
}

export interface CreatedServiceController {
  readonly controller: ServiceController;
  readonly stateMachine: ServiceStateMachine;
  readonly providerConfig: ProviderConfigService;
  readonly settings: SettingsStore;
  readonly persona: PersonaStore;
  readonly safety: SafetyPolicyStore;
  readonly audit: AuditStoreWorker;
  readonly diagnostics: DiagnosticsSource;
  /** Transactional outbox consumer (M7-02); started by main/index.ts. */
  readonly goldenSync: GoldenSyncWorker;
  readonly shutdown: () => void;
}

export async function createServiceController(
  options: CreateServiceControllerOptions,
): Promise<CreatedServiceController> {
  const settings = new SettingsStore(options.dataDir);
  const credentials = new CredentialStore(options.dataDir, options.safeStorage);
  const providerConfig = new ProviderConfigService(settings, credentials);
  const keyManager = new CryptoKeyManager(credentials);
  await keyManager.ensureKeys(options.keyVersion);

  const migrations: MigrationFile[] = [{ version: 1, path: options.migrationPath }];
  const dbPath = join(options.dataDir, 'audit', 'audit.sqlite');
  const audit = new AuditStoreWorker({
    dbPath,
    migrations,
    keyManager,
    keyVersion: options.keyVersion,
  });
  const persona = new PersonaStore({ dbPath, migrations, keyManager, keyVersion: options.keyVersion });
  const safety = new SafetyPolicyStore({
    dbPath,
    migrations,
    keyManager,
    keyVersion: options.keyVersion,
    settingsStore: settings,
  });

  const douyinSidecar = new DouyinLiveSidecarManager({
    binaryPath: options.douyinLiveBinaryPath,
    dataDir: join(options.dataDir, 'douyin'),
  });
  const qdrantSidecar = new QdrantSidecarManager({
    binaryPath: options.qdrantBinaryPath,
    dataDir: join(options.dataDir, 'qdrant'),
  });
  const qdrantClient = new QdrantClient({
    url: `http://${QDRANT_LOOPBACK_HOST}:${QDRANT_HTTP_PORT}`,
  });
  // M7-02: drains label revisions into golden_set via the transactional outbox.
  const goldenSync = new GoldenSyncWorker({ audit, qdrantClient });

  // M6-08: report the audit volume's free space in the diagnostics summary.
  // statfsSync is available on Windows and Linux; a read failure just omits it.
  // The same volume read feeds the startup gate (M7-07, ≥ 2 GiB) and the
  // running-period monitor (M7-07, 256 MiB → AUDIT_UNAVAILABLE stop).
  const readStorage = () => {
    try {
      const stat = statfsSync(options.dataDir);
      return { availableBytes: stat.bavail * stat.bsize, totalBytes: stat.blocks * stat.bsize };
    } catch {
      return null;
    }
  };
  const diagnostics = new DiagnosticsSource({ readStorage });
  const stateMachine = new ServiceStateMachine();
  const checks = createServiceGateChecks({
    settings,
    credentials,
    audit,
    persona,
    safety,
    qdrant: qdrantSidecar,
    qdrantClient,
    readStorage,
  });

  // Real-time suggestion pipeline (M5-07). A missing published safety policy
  // fails closed: the orchestrator freezes compiled rules only from a published
  // version; the gate already requires one before the service can RUNNING.
  const orchestrator = new SuggestionAttemptOrchestrator({
    audit,
    stateMachine,
    router: new PersonaRouter(persona),
    personas: persona,
    safety,
    retriever: new SuggestionRetriever(qdrantClient),
    providerConfig,
    credentials,
    createProvider: (adapterType) => {
      if (adapterType === 'DEEPSEEK') return new DeepSeekProvider();
      if (adapterType === 'OPENAI_COMPATIBLE') return new OpenAiCompatibleProvider();
      // ANTHROPIC_MESSAGES has no adapter yet (M5-04 decision); fail closed.
      throw new Error(`unsupported adapter type: ${String(adapterType)}`);
    },
    validator: new SuggestionOutputValidator(),
    displaySink: options.displaySink ?? createStubDisplaySink(),
    nowMonotonic: () => performance.now(),
    windowMaxAgeMs: 1500,
    candidateMaxCount: 50,
    directPushThreshold: 0.85,
    // PRD: 展示窗口默认 10 秒；M6-06 从用户偏好按次读取（UI §7 应用于下一次展示）。
    // 配置损坏时兜底默认值，避免展示路径楔死。
    displayDurationMs: 10_000,
    getDisplayDurationMs: async () => {
      try {
        return (await settings.get())?.overlay?.durationMs ?? 10_000;
      } catch {
        return 10_000;
      }
    },
    onAuditFailure: () => {
      // Audit down ⇒ stop producing suggestions; service must not continue.
      void controller.stop('AUDIT_UNAVAILABLE');
    },
    // Diagnostics (M6-02): feed the anonymous run summary from the real-time path.
    onCommentReceived: () => diagnostics.recordCommentReceived(),
    onSuggestionResult: (result, e2eLatencyMs) => diagnostics.recordSuggestion(result, e2eLatencyMs),
  });

  const createLiveSession = async (params: { roomReference: string; platformRoomId?: string }) => {
    const sessionId = await createLiveSessionWriter({ audit, settings })(params);
    await orchestrator.startSession({ sessionId });
    return sessionId;
  };

  // RUNBOOK §5.3: below 256 MiB the service must stop (E_AUDIT_UNAVAILABLE) and
  // refuse new attempts. The monitor only runs while the service is RUNNING; the
  // controller starts/stops it with the lifecycle.
  const storageMonitor = new StorageMonitor({
    readStorage,
    onCritical: () => {
      void controller.stop('AUDIT_UNAVAILABLE');
    },
  });

  const controller = new ServiceController({
    stateMachine,
    sidecar: douyinSidecar,
    createAdapter: (roomReference) => new DouyinLiveWsAdapter({ roomReference }),
    checks,
    createLiveSession,
    onComment: (comment) => orchestrator.handleComment(comment),
    cleanupOnStop: (reason: NonNullable<ServiceViewState['stopReason']>) => {
      orchestrator.abortAll(stopReasonToCancelReason(reason));
      orchestrator.endSession();
      options.cleanupOnStop();
    },
    storageMonitor,
  });

  const shutdown = () => {
    goldenSync.stop();
    audit.close();
    persona.close();
    safety.close();
  };

  return {
    controller,
    stateMachine,
    providerConfig,
    settings,
    persona,
    safety,
    audit,
    diagnostics,
    goldenSync,
    shutdown,
  };
}

/** M5-07 stub: acknowledges first frame immediately; M6-07 replaces it. */
function createStubDisplaySink(): SuggestionDisplaySink {
  return {
    async show() {
      return { ok: true, firstFrameAtMonotonicMs: performance.now() };
    },
    async hide() {
      // nothing to hide in the stub
    },
  };
}

function stopReasonToCancelReason(
  reason: NonNullable<ServiceViewState['stopReason']>,
): CancelTraceReason {
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
