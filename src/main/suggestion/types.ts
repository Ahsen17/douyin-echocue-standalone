import type {
  OverlayDisplayPayloadV1,
  ProviderConfigV1,
  QueueingConfigV1,
  SourceComment,
  ValidatedSuggestionV1,
} from '@echocue/contracts';
import type { AuditStoreWorker } from '../storage/index.js';
import type { ServiceStateMachine } from '../service/index.js';
import type { PersonaRouter, PersonaStore, PersonaRoute } from '../persona/index.js';
import type { SafetyPolicyStore } from '../safety/index.js';
import type { CompiledRiskFilter } from '../safety/risk-filter-config.js';
import type { SuggestionRetriever, CalibratedRetrieval, CalibrationArtifactV1 } from '../retrieval/index.js';
import type { ProviderConfigService, ProviderAuditRecord, TextGenerationProvider } from '../provider/index.js';
import type { CredentialStore } from '../credentials/index.js';
import type { SuggestionOutputValidator } from '../validation/index.js';
import type { PersonaSnapshot, SafetySnapshot, SystemPromptConfig } from '../prompt/types.js';
import type { CancelTraceReason } from '../validation/types.js';

export type { ValidatedSuggestionV1 };

/** A SourceComment bound to the current session/window with a trace identity. */
export interface ProcessingComment extends SourceComment {
  sessionId: string;
  traceId: string;
  windowVersion: number;
  freshnessDeadlineMonotonicMs: number;
}

/** A safe candidate held in the latest rolling window (ARCH §4.1). */
export interface PendingCandidate {
  traceId: string;
  sourceMessageId: string;
  receivedMonotonicMs: number;
  /** Max retrievalConfidence of mergedTopK; 0 when none (LLM-first candidate). */
  priority: number;
  processingComment: ProcessingComment;
  personaRoute: PersonaRoute;
  personaSnapshot: PersonaSnapshot;
  safetySnapshot: SafetySnapshot;
  calibrated: CalibratedRetrieval;
  /** Retrieval evidence attached to the transition leaving RETRIEVING (CR-1). */
  querySnapshots: ReadonlyArray<{
    snapshotId: string;
    contentType: 'DECISION_JSON';
    role: 'GOLDEN_QUERY_RESULT' | 'PRE_QUERY_RESULT' | 'RERANK_DECISION';
    plaintext: Buffer;
  }>;
}

/** The latest window summary: candidates within windowMaxAgeMs (ARCH §4.1). */
export interface WindowSummary {
  windowVersion: number;
  openedAtMonotonicMs: number;
  candidates: Map<string, PendingCandidate>;
}

/** A single in-flight suggestion attempt (bound identity + cancellation). */
export interface SuggestionAttempt {
  traceId: string;
  sessionId: string;
  windowVersion: number;
  abortController: AbortController;
  cancelReason: CancelTraceReason;
  freshnessDeadlineMonotonicMs: number;
  startedAtMonotonicMs: number;
  comment: ProcessingComment;
  personaRoute: PersonaRoute;
  personaSnapshot: PersonaSnapshot;
  safetySnapshot: SafetySnapshot;
  calibrated: CalibratedRetrieval;
  path: 'DIRECT' | 'LLM';
  /** Captured for M5-09 to persist LLM_REQUEST_META / LLM_RAW_RESPONSE snapshots. */
  providerAuditRecord: ProviderAuditRecord | null;
}

/** Overlay port; M6-07 implements the real Electron window. */
export interface SuggestionDisplaySink {
  show(
    payload: OverlayDisplayPayloadV1,
    meta: { sessionId: string; traceId: string; windowVersion: number },
  ): Promise<{ ok: true; firstFrameAtMonotonicMs: number } | { ok: false; reason: string }>;
  hide(): Promise<void>;
}

export interface SuggestionOrchestratorDeps {
  audit: AuditStoreWorker;
  stateMachine: ServiceStateMachine;
  router: PersonaRouter;
  personas: PersonaStore;
  safety: SafetyPolicyStore;
  retriever: SuggestionRetriever;
  providerConfig: ProviderConfigService;
  credentials: CredentialStore;
  createProvider: (adapterType: ProviderConfigV1['adapterType']) => TextGenerationProvider;
  validator: SuggestionOutputValidator;
  displaySink: SuggestionDisplaySink;
  nowMonotonic: () => number;
  windowMaxAgeMs: number;
  candidateMaxCount: number;
  /** Overlay display-window duration (PRD: 10s default); M6-06 wires the user preference. */
  displayDurationMs?: number;
  /** Live read of the display-window duration per display (UI §7: next-display). */
  getDisplayDurationMs?: () => Promise<number>;
  directPushThreshold: number;
  calibrationArtifact?: CalibrationArtifactV1;
  /** WP-4: live reads of the run-page thresholds; frozen per session. */
  getDirectPushThreshold?: () => Promise<number>;
  getSemanticDiscardConfidence?: () => Promise<number>;
  maxContextBudget?: number;
  /** TD-08: live read of the user-configured system prompt (null → code default). */
  getSystemPrompt?: () => Promise<SystemPromptConfig | null>;
  /** WP-2: FIFO danmaku queueing during the display window (null → disabled). */
  getQueueing?: () => Promise<QueueingConfigV1 | null>;
  /** WP-10: user-configured risk filter, compiled per session (empty → no filtering). */
  getRiskFilter?: () => Promise<CompiledRiskFilter | null>;
  onAuditFailure: () => void;
  /** Diagnostics hooks (M6-02): feed the anonymous run summary. */
  onCommentReceived?: () => void;
  onSuggestionResult?: (
    result: 'displayed' | 'filtered' | 'discarded' | 'failed',
    e2eLatencyMs?: number,
  ) => void;
  /** WP-1 observability hooks: enum-category labels only, never content. */
  onCommentFiltered?: (category: string) => void;
  onSemanticType?: (type: string) => void;
  onRetrievalCompleted?: (latencyMs: number) => void;
  onLlmRequest?: () => void;
  onLlmCompleted?: (latencyMs: number, ok: boolean, errorType?: string) => void;
}
