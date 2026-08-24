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
import { compileRiskFilter } from '../safety/risk-filter-config.js';
import { QDRANT_HTTP_PORT, QDRANT_LOOPBACK_HOST, QdrantSidecarManager } from '../qdrant/index.js';
import { DouyinLiveSidecarManager, DouyinLiveWsAdapter } from '../douyin/index.js';
import { DeepSeekProvider, OpenAiCompatibleProvider, ProviderConfigService } from '../provider/index.js';
import { SuggestionRetriever } from '../retrieval/index.js';
import { GoldenSyncWorker } from '../reflux/index.js';
import { SuggestionOutputValidator } from '../validation/index.js';
import { SuggestionAttemptOrchestrator } from '../suggestion/index.js';
import type { SuggestionDisplaySink } from '../suggestion/index.js';
import type { CancelTraceReason } from '../validation/index.js';
import {
  DiagnosticsSource,
  EchocueMetrics,
  MetricsHub,
  SessionMetrics,
  createMetricsServer,
  type Logger,
} from '../telemetry/index.js';
import { ServiceController } from './ServiceController.js';
import type { ServiceControllerOptions } from './ServiceController.js';
import { createLiveSessionWriter, createServiceGateChecks } from './service-gate.js';
import { ServiceStateMachine } from './ServiceStateMachine.js';

export interface CreateServiceControllerOptions {
  dataDir: string;
  safeStorage: SafeStorageLike;
  douyinLiveBinaryPath: string;
  qdrantBinaryPath: string;
  qdrantConfigTemplatePath?: string;
  /** Version+SHA-256 pins re-verified at every sidecar start (E_SIDECAR_START_FAILED on mismatch). */
  sidecarPins?: {
    qdrant: { version: string; sha256: string };
    douyinLive: { version: string; sha256: string };
  };
  /** Ordered SQLite migrations (001 initial schema, 002 queue-timeout reason …). */
  migrations: MigrationFile[];
  keyVersion: string;
  cleanupOnStop: () => void;
  /** Optional file logger (wired by the app boot for daily logs under the data dir). */
  logger?: Logger;
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
  /** WP-1 observability facade (Prometheus + per-session counters + /metrics). */
  readonly metricsHub: MetricsHub;
  /** Transactional outbox consumer (M7-02); started by main/index.ts. */
  readonly goldenSync: GoldenSyncWorker;
  /** Retrieval-init IPC (retrieval.getStatus/importPreSet) and boot-sidecar start. */
  readonly qdrant: QdrantSidecarManager;
  readonly qdrantClient: QdrantClient;
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

  const migrations = options.migrations;
  const dbPath = join(options.dataDir, 'audit', 'audit.sqlite');
  const audit = new AuditStoreWorker({
    dbPath,
    migrations,
    keyManager,
    keyVersion: options.keyVersion,
  });
  // RUNBOOK §5.3 crash recovery: a process restart must verify integrity
  // before the service may run. A mismatch fails the whole app init (the
  // caller keeps the service stopped instead of trusting corrupt audit data).
  // Close the audit handle on the failure path so the DB file is not left
  // locked while the user repairs it.
  try {
    audit.verifyIntegrity();
  } catch (err) {
    audit.close();
    throw err;
  }
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
    expectedVersion: options.sidecarPins?.douyinLive.version,
    sha256: options.sidecarPins?.douyinLive.sha256,
  });
  const qdrantSidecar = new QdrantSidecarManager({
    binaryPath: options.qdrantBinaryPath,
    dataDir: join(options.dataDir, 'qdrant'),
    configTemplatePath: options.qdrantConfigTemplatePath,
    expectedVersion: options.sidecarPins?.qdrant.version,
    sha256: options.sidecarPins?.qdrant.sha256,
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
  // WP-1 observability (TD-03): Prometheus registry + per-session counters + a
  // loopback /metrics server. Port from settings.metrics (default 9100); when
  // disabled the in-app monitoring section still works, just no HTTP endpoint.
  const metricsConfig = (await settings.get())?.metrics ?? { enabled: true, port: 9100 };
  const metrics = new EchocueMetrics();
  const sessionMetrics = new SessionMetrics();
  const metricsServer = metricsConfig.enabled
    ? createMetricsServer({
        metrics,
        port: metricsConfig.port,
        log: (message) => options.logger?.info('telemetry', message),
      })
    : null;
  const metricsHub = new MetricsHub({ metrics, session: sessionMetrics, server: metricsServer });
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
    // 2026-08-24：LLM 时间窗口放宽到 10s（与 T0_FRESHNESS_BUDGET_MS 同步）。
    windowMaxAgeMs: 10_000,
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
    // TD-08: the orchestrator freezes this once per session (null → code default).
    getSystemPrompt: async () => {
      try {
        const prompt = (await settings.get())?.prompt;
        return prompt === undefined
          ? null
          : { systemPromptTemplate: prompt.systemPromptTemplate, templateVersion: prompt.templateVersion };
      } catch {
        return null;
      }
    },
    // WP-2: FIFO danmaku queueing config, frozen per session (default off).
    getQueueing: async () => {
      try {
        return (await settings.get())?.queueing ?? null;
      } catch {
        return null;
      }
    },
    // WP-4: run-page retrieval thresholds from settings.internalRetrieval, frozen
    // per session; the deps-level values remain the fallback.
    getDirectPushThreshold: async () => {
      try {
        return (await settings.get())?.internalRetrieval.directPushThreshold ?? 0.85;
      } catch {
        return 0.85;
      }
    },
    getSemanticDiscardConfidence: async () => {
      try {
        return (await settings.get())?.internalRetrieval.semanticDiscardConfidence ?? 0.9;
      } catch {
        return 0.9;
      }
    },
    // WP-10: compile the configured risk filter once per session (empty → none).
    getRiskFilter: async () => {
      try {
        const types = (await settings.get())?.riskFilter?.types ?? [];
        return compileRiskFilter(types);
      } catch {
        return null;
      }
    },
    onAuditFailure: () => {
      // Audit down ⇒ stop producing suggestions; service must not continue.
      void controller.stop('AUDIT_UNAVAILABLE');
    },
    // Diagnostics (M6-02) + metrics (WP-1): feed the anonymous run summary and
    // the Prometheus/per-session counters from the same real-time path.
    onCommentReceived: () => {
      diagnostics.recordCommentReceived();
      metricsHub.recordCommentReceived();
    },
    onCommentFiltered: (category) => metricsHub.recordCommentFiltered(category),
    onSemanticType: (type) => metricsHub.recordSemanticType(type),
    onRetrievalCompleted: (latencyMs) => metricsHub.recordRetrievalCompleted(latencyMs),
    onLlmRequest: () => metricsHub.recordLlmRequest(),
    onLlmCompleted: (latencyMs, ok, errorType) => metricsHub.recordLlmCompleted(latencyMs, ok, errorType),
    onSuggestionResult: (result, e2eLatencyMs) => {
      diagnostics.recordSuggestion(result, e2eLatencyMs);
      metricsHub.recordSuggestionResult(result, e2eLatencyMs);
    },
  });

  const createLiveSession = async (params: { roomReference: string; platformRoomId?: string }) => {
    const sessionId = await createLiveSessionWriter({ audit, settings })(params);
    metricsHub.resetSession(sessionId);
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
      metricsHub.freezeSession();
      options.cleanupOnStop();
    },
    storageMonitor,
    logger: options.logger,
  });

  const shutdown = () => {
    goldenSync.stop();
    // Close the other connections to the same audit.sqlite first so audit's
    // checkpoint (wal_checkpoint TRUNCATE) runs with no competing connection
    // holding the WAL (N2).
    persona.close();
    safety.close();
    audit.close();
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
    metricsHub,
    goldenSync,
    qdrant: qdrantSidecar,
    qdrantClient,
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
