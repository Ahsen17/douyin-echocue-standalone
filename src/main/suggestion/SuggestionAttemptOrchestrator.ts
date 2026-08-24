import type {
  AuditContentTypeV1,
  AuditSnapshotRoleV1,
  GoldenSetPayloadV1,
  OverlayDisplayPayloadV1,
  SourceComment,
  TraceReasonCodeV1,
  TraceState,
  ValidatedSuggestionV1,
} from '@echocue/contracts';
import type { PersonaRoute } from '../persona/index.js';
import { evaluateInputSafety } from '../safety/index.js';
import type { CompiledRiskFilter } from '../safety/risk-filter-config.js';
import { evaluateRetrieval } from '../retrieval/index.js';
import { DEFAULT_CALIBRATION_ARTIFACT_V1, type CalibrationArtifactV1 } from '../retrieval/calibration.js';
import { evaluateDirectPush } from '../retrieval/direct-push.js';
import { renderPrompt, type SystemPromptConfig } from '../prompt/index.js';
import { CredentialStore } from '../credentials/index.js';
import { AuditDuplicateTraceError, AuditUnavailableError } from '../storage/index.js';
import { uuidv7 } from '../util/index.js';
import { SuggestionWindow } from './SuggestionWindow.js';
import { formatOverlaySentTime } from './format-overlay-sent-time.js';
import type { SuggestionOrchestratorDeps } from './types.js';
import type { PendingCandidate, ProcessingComment, SuggestionAttempt } from './types.js';
import type { CancelTraceReason, OutputValidationContext, TeamMemberNameV1 } from '../validation/types.js';

// Full freshness deadline (CONTRACT §6): min(t0+10000, selectedAt+10000,
// t0+windowMaxAgeMs). The windowOpenedAt term is the candidate's own entry time
// (receivedMonotonicMs), so its budget is t0 + windowMaxAgeMs.
//
// 2026-08-24 校准：LLM 调用时间窗口放宽到 10s——Provider 硬超时、t0 上限、
// 选中后预算与窗口驻留四者同步从 5s/2.5s 提到 10s（min 中任一项偏小都会把
// 截止截在更短处）。DeepSeek 一次 JSON 生成真实延迟 1~3s，10s 上限提供充足
// 余量；这是安全上限，不是目标时延（E2E P95 ≤3s 目标不变）。
const T0_FRESHNESS_BUDGET_MS = 10_000;
const SELECTED_BUDGET_MS = 10_000;
// Overlay display-window duration (PRD: default 10s, user-configurable).
const DISPLAY_DURATION_MS = 10_000;
// Provider hard timeout (CONTRACT §6): 10s, superseded by an earlier freshness deadline.
const PROVIDER_TIMEOUT_MS = 10_000;
// Latest-window defaults (ARCH §4.1); overridden by settings.internalRetrieval.
const WINDOW_MAX_AGE_MS = 10_000;
const WINDOW_CANDIDATE_MAX_COUNT = 50;
// Bounded session dedup (ARCH §4.1): cap the seen-set to bound memory in a long
// stream; a fresh window resets it via startSession.
const SEEN_SET_MAX = 100_000;
// WP-2 FIFO display-window queue: bounded backlog for comments arriving while
// DISPLAYING. One is promoted per display end; the cap bounds memory.
const QUEUE_MAX = 50;

interface FrozenSafety {
  version: string;
  policyText: string;
  keywords: string[];
  compiledRules: OutputValidationContext['compiledRules'];
}

/** Snapshot input for the audit worker (single-source shape). */
interface AuditSnapshotInput {
  snapshotId: string;
  contentType: AuditContentTypeV1;
  role: AuditSnapshotRoleV1;
  plaintext: Buffer;
}

/**
 * Real-time SuggestionAttempt orchestration (ARCH §4/§4.1, ATLAS §4/§7.2).
 * One attempt at a time; golden direct-push first, at most one LLM call; no
 * generation or queueing while activity is DISPLAYING. Every state transition
 * stays inside TRACE_TRANSITIONS_V1; every audit write is guarded so an audit
 * failure aborts the in-flight attempt and stops the service via onAuditFailure
 * (never log-and-continue). A freshness/cancel miss always closes the trace to
 * a terminal and releases the single-attempt mutex.
 */
export class SuggestionAttemptOrchestrator {
  private readonly deps: SuggestionOrchestratorDeps;
  private readonly window: SuggestionWindow;
  private session: { sessionId: string; seen: Set<string> } | null = null;
  private attempt: SuggestionAttempt | null = null;
  private abortRequested = false;
  private auditDown = false;
  /** Display-window timer handle; cleared on attempt clear / stop (M5-08). */
  private displayTimer: ReturnType<typeof setTimeout> | null = null;
  private frozenSafety: FrozenSafety | null = null;
  private frozenMembers: readonly TeamMemberNameV1[] = [];
  private frozenSystemPrompt: SystemPromptConfig | null = null;
  /** WP-2: frozen display-window queueing config (null = disabled). */
  private frozenQueueing: { enabled: boolean; timeoutMs: number } | null = null;
  /** WP-4: run-page retrieval thresholds, frozen per session like safety/prompt. */
  private frozenDirectPushThreshold: number | null = null;
  private frozenSemanticDiscardConfidence: number | null = null;
  /** WP-10: frozen configured risk filter (empty ⇒ no risk filtering). */
  private frozenRiskFilter: CompiledRiskFilter | null = null;
  /** WP-2: FIFO backlog of comments audited RECEIVED→NORMALIZED while DISPLAYING. */
  private pendingQueue: ProcessingComment[] = [];
  /** Last written trace state per traceId, so async error paths close the chain. */
  private readonly traceState = new Map<string, TraceState>();
  /** Window candidates keyed by traceId, so eviction can close their chain. */
  private readonly windowedComments = new Map<string, ProcessingComment>();

  constructor(deps: SuggestionOrchestratorDeps) {
    this.deps = deps;
    this.window = new SuggestionWindow({
      windowMaxAgeMs: deps.windowMaxAgeMs ?? WINDOW_MAX_AGE_MS,
      candidateMaxCount: deps.candidateMaxCount ?? WINDOW_CANDIDATE_MAX_COUNT,
      // Close the audit chain of any candidate evicted without being selected,
      // so no trace is ever left dangling in RETRIEVING (MAJOR-1).
      onEvict: (traceId) => {
        const candidate = this.windowedComments.get(traceId);
        if (candidate === undefined) return;
        this.closeChain(candidate, 'LOW_VALUE');
        this.windowedComments.delete(traceId);
      },
    });
  }

  async startSession(input: { sessionId: string }): Promise<void> {
    this.clearDisplayTimer();
    const versionId = await this.deps.safety.getActivePublishedVersion();
    if (versionId !== null) {
      const policy = this.deps.safety.readPolicy(versionId);
      this.frozenSafety = {
        version: versionId,
        policyText: policy.policyText,
        keywords: policy.keywords,
        compiledRules: policy.compiledRules,
      };
    } else {
      this.frozenSafety = null;
    }
    this.frozenMembers = this.deps.personas.listPersonas().map((persona) => ({
      personaId: persona.personaId,
      displayName: persona.displayName,
      enabledAliases: this.deps.personas
        .listAliases(persona.personaId)
        .filter((alias) => alias.enabled)
        .map((alias) => alias.aliasText),
    }));
    // TD-08: freeze the configured system prompt for the whole session, the same
    // way safety/members are frozen — no hot-swap mid-run.
    this.frozenSystemPrompt = (await this.deps.getSystemPrompt?.()) ?? null;
    // WP-2: freeze queueing for the session; close any queued comments left over
    // from a previous session (their traces would otherwise dangle in NORMALIZED).
    this.frozenQueueing = (await this.deps.getQueueing?.()) ?? null;
    this.closePendingQueue('STALE_SESSION');
    // WP-4: freeze the run-page thresholds (deps value / calibration default is
    // the fallback when the getter is absent or settings are unreadable).
    this.frozenDirectPushThreshold = (await this.deps.getDirectPushThreshold?.()) ?? null;
    this.frozenSemanticDiscardConfidence = (await this.deps.getSemanticDiscardConfidence?.()) ?? null;
    // WP-10: freeze the configured risk filter for the whole session.
    this.frozenRiskFilter = (await this.deps.getRiskFilter?.()) ?? null;
    this.session = { sessionId: input.sessionId, seen: new Set() };
    this.attempt = null;
    this.abortRequested = false;
    this.auditDown = false;
    this.window.clear();
    this.traceState.clear();
    this.windowedComments.clear();
  }

  /** Stop the live session: clear in-flight state and the rolling window. */
  endSession(): void {
    this.clearDisplayTimer();
    this.session = null;
    this.attempt = null;
    this.abortRequested = true;
    this.window.clear();
    // Close any queued comments (their traces otherwise dangle in NORMALIZED).
    this.closePendingQueue('STALE_SESSION');
    // traceState is NOT cleared here: an in-flight runAttempt continuation may
    // still run after the synchronous stop block and must close its chain from
    // the real last state (CRITICAL-1). It is cleared on the next startSession.
    this.windowedComments.clear();
  }

  getCurrentAttempt(): SuggestionAttempt | null {
    return this.attempt;
  }

  /**
   * Entry point for a COMMENT event. Fire-and-forget: never blocks the WS event
   * loop. The trace chain and audit writes are synchronous; retrieval and
   * generation continue in the background under the single-attempt mutex.
   */
  handleComment(comment: SourceComment): void {
    if (this.session === null) return;
    this.deps.onCommentReceived?.();
    const sessionId = this.session.sessionId;
    const traceId = uuidv7();
    const windowVersion = this.window.version;
    const processingComment: ProcessingComment = {
      ...comment,
      sessionId,
      traceId,
      windowVersion,
      // Pre-attempt bound: the tightest t0-anchored term before selection
      // (窗口驻留, 与 5s 窗口淘汰一致；2026-08 校准)。The full min formula is
      // applied when the attempt is created (M5-08, CONTRACT §6).
      freshnessDeadlineMonotonicMs:
        comment.receivedMonotonicMs +
        Math.min(T0_FRESHNESS_BUDGET_MS, this.deps.windowMaxAgeMs ?? WINDOW_MAX_AGE_MS),
    };

    // Session dedup runs before every write (ARCH §4.1): a duplicate frame is
    // dropped silently — its first occurrence already owns a trace, and
    // audit_trace's UNIQUE(session_id, source_message_id) forbids a second row.
    // Checked before the DISPLAYING guard so duplicates that arrive while the
    // source message is still displayed (or was display-suppressed) are dropped
    // too, instead of colliding with the unique constraint.
    if (this.session.seen.has(comment.sourceMessageId)) {
      return;
    }
    this.session.seen.add(comment.sourceMessageId);
    if (this.session.seen.size > SEEN_SET_MAX) {
      this.evictSeenHalf();
    }

    // DISPLAYING guard: no retrieval, no generation (ARCH §4.1). WP-2: with
    // queueing enabled, buffer the comment (audited RECEIVED→NORMALIZED) for a
    // FIFO replay after the display window ends; otherwise discard as before.
    if (this.deps.stateMachine.getViewState().activity === 'DISPLAYING') {
      if (!this.beginTrace(processingComment)) return;
      this.transition(processingComment, null, 'RECEIVED', 'EVENT_RECEIVED', [
        this.snap('RAW_EVENT_JSON', 'RAW_WS_EVENT', comment.rawEvent),
      ]);
      this.transition(processingComment, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK', [
        this.snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', comment),
      ]);
      if (this.frozenQueueing?.enabled && this.pendingQueue.length < QUEUE_MAX) {
        this.pendingQueue.push(processingComment);
        return;
      }
      this.transition(processingComment, 'NORMALIZED', 'DISCARDED', 'DISPLAY_WINDOW_ACTIVE', [
        this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason: 'DISPLAY_WINDOW_ACTIVE' }),
      ]);
      return;
    }

    if (!this.beginTrace(processingComment)) return;
    this.transition(processingComment, null, 'RECEIVED', 'EVENT_RECEIVED', [
      this.snap('RAW_EVENT_JSON', 'RAW_WS_EVENT', comment.rawEvent),
    ]);
    this.transition(processingComment, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK', [
      this.snap('NORMALIZED_COMMENT_JSON', 'NORMALIZED_COMMENT', comment),
    ]);

    // Safety → routing → retrieval, shared with queued-comment promotion (WP-2).
    this.continueFromNormalized(processingComment);
  }

  /**
   * Continue a comment already audited RECEIVED→NORMALIZED: input safety, member
   * routing, then retrieval. Used by the live path and by queue promotion (WP-2).
   */
  private continueFromNormalized(processingComment: ProcessingComment): void {
    // Input safety against the frozen compiled rules + configured risk filter (ARCH §4.4).
    const safety = evaluateInputSafety({
      normalizedText: processingComment.normalizedText,
      compiledRules: this.frozenSafety?.compiledRules ?? null,
      riskFilter: this.frozenRiskFilter,
    });
    if (!safety.allow) {
      this.transition(processingComment, 'NORMALIZED', 'FILTERED', 'INPUT_SAFETY_FILTERED', [
        this.snap('DECISION_JSON', 'FILTER_DECISION', safety),
        this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason: safety.reason }),
      ]);
      this.deps.onCommentFiltered?.(safety.reason);
      this.deps.onSuggestionResult?.('filtered');
      return;
    }

    // Routing + frozen persona snapshot (ARCH §4.2). A routing failure or a
    // missing version fails closed without crashing the WS callback.
    let personaRoute: PersonaRoute;
    let personaSnapshot: SuggestionAttempt['personaSnapshot'];
    try {
      personaRoute = this.deps.router.route(processingComment.normalizedText);
      const meta = this.deps.personas.getVersionMeta(personaRoute.personaVersion);
      personaSnapshot = {
        personaId: personaRoute.personaId,
        personaVersion: personaRoute.personaVersion,
        nickname: personaRoute.displayName,
        content: personaRoute.personaMarkdown,
        contentHmac: meta.contentHmac,
      };
    } catch {
      this.transition(processingComment, 'NORMALIZED', 'DISCARDED', 'LOW_VALUE', [
        this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason: 'LOW_VALUE', note: 'routing unavailable' }),
      ]);
      return;
    }
    // t1 = filter+routing complete (RESEARCH §6.1); recorded in the route snapshot.
    const filterCompleteAtMonotonicMs = this.deps.nowMonotonic();
    this.transition(processingComment, 'NORMALIZED', 'ROUTED', 'PERSONA_ROUTED', [
      this.snap('DECISION_JSON', 'PERSONA_ROUTE', {
        personaId: personaRoute.personaId,
        decision: personaRoute.decision,
        candidates: personaRoute.candidates,
        filterCompleteAtMonotonicMs,
      }),
      this.snap('PERSONA_TEXT', 'PERSONA_VERSION_SNAPSHOT', personaSnapshot),
    ]);

    // Only move to RETRIEVING from LISTENING; during an in-flight attempt
    // (RETRIEVING/GENERATING) a new comment is windowed without disturbing the
    // global activity (GENERATING → RETRIEVING is an illegal activity edge).
    this.enterRetrieving();
    void this.retrieve(processingComment, personaRoute, personaSnapshot).catch((err) =>
      this.handlePipelineError(processingComment, err),
    );
  }

  /** Cancel any in-flight attempt with a concrete reason (M5-08 wires stop). */
  abortAll(reason: CancelTraceReason): void {
    this.abortRequested = true;
    // Close the queued backlog too; traces would otherwise dangle in NORMALIZED.
    this.closePendingQueue(reason);
    if (this.attempt === null) return;
    this.attempt.cancelReason = reason;
    this.attempt.abortController.abort();
    // ARCH §6.2: an audit/cancel path must hide any not-yet-displayed suggestion.
    void this.deps.displaySink.hide();
    // Close the in-flight chain NOW from its real last state. The async
    // continuation may outlive the synchronous stop block (CRITICAL-1); closing
    // here leaves a terminal state so the late continuation closes to a no-op.
    this.cancelAttempt(this.attempt, reason);
  }

  /**
   * Display window has ended (M5-08 timer target): hide, clear the window,
   * bump windowVersion and pick the next best candidate.
   */
  finishDisplay(): void {
    const current = this.attempt;
    if (current !== null) {
      this.transition(current.comment, 'DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED', [
        this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason: 'DISPLAY_DURATION_ELAPSED' }),
      ]);
    }
    void this.deps.displaySink.hide();
    this.resetWindowAfterDisplay();
    this.clearAttempt();
    // WP-2: after the window closes, promote the oldest fresh queued comment.
    this.drainQueue();
  }

  private async retrieve(
    processingComment: ProcessingComment,
    personaRoute: PersonaRoute,
    personaSnapshot: SuggestionAttempt['personaSnapshot'],
  ): Promise<void> {
    // ROUTED only allows RETRIEVING, so enter RETRIEVING before any await; a
    // later search failure then closes from RETRIEVING (a legal DISCARDED edge).
    const preCancel = this.commentCancelled(processingComment);
    if (!preCancel.ok) {
      this.closeChain(processingComment, preCancel.reason);
      this.restoreListening();
      return;
    }
    this.transition(processingComment, 'ROUTED', 'RETRIEVING', 'RETRIEVAL_STARTED');
    const preAwait = this.commentCancelled(processingComment);
    if (!preAwait.ok) {
      this.closeChain(processingComment, preAwait.reason);
      this.restoreListening();
      return;
    }
    const retrievalStartedAt = this.deps.nowMonotonic();
    let raw;
    try {
      raw = await this.deps.retriever.search({
        queryText: processingComment.normalizedText,
        personaId: personaRoute.personaId,
        personaVersion: personaRoute.personaVersion,
      });
    } catch {
      this.transition(processingComment, 'RETRIEVING', 'DISCARDED', 'LOW_VALUE', [
        this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason: 'LOW_VALUE', note: 'retrieval failed' }),
      ]);
      this.restoreListening();
      return;
    }
    const postSearch = this.commentCancelled(processingComment);
    if (!postSearch.ok) {
      this.closeChain(processingComment, postSearch.reason);
      this.restoreListening();
      return;
    }
    this.deps.onRetrievalCompleted?.(this.deps.nowMonotonic() - retrievalStartedAt);
    const calibrated = evaluateRetrieval(raw, { artifact: this.effectiveCalibrationArtifact() });
    this.deps.onSemanticType?.(calibrated.semanticDecision.topSemanticType);
    // Retrieval evidence is attached to the transition that leaves RETRIEVING
    // (DIRECT_READY / PROMPT_RENDERED / DISCARDED), never a self-edge.
    const querySnapshots = [
      this.snap('DECISION_JSON', 'GOLDEN_QUERY_RESULT', { hits: calibrated.goldenHits }),
      this.snap('DECISION_JSON', 'PRE_QUERY_RESULT', { hits: calibrated.preHits }),
      this.snap('DECISION_JSON', 'RERANK_DECISION', { mergedTopK: calibrated.mergedTopK }),
    ] as PendingCandidate['querySnapshots'];
    if (calibrated.semanticDecision.action === 'DISCARD') {
      this.transition(processingComment, 'RETRIEVING', 'DISCARDED', 'LOW_VALUE', [
        ...querySnapshots,
        this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason: 'LOW_VALUE', note: 'semantic discard' }),
      ]);
      this.restoreListening();
      return;
    }
    const candidate: PendingCandidate = {
      traceId: processingComment.traceId,
      sourceMessageId: processingComment.sourceMessageId,
      receivedMonotonicMs: processingComment.receivedMonotonicMs,
      priority: calibrated.mergedTopK[0]?.retrievalConfidence ?? 0,
      processingComment,
      personaRoute,
      personaSnapshot,
      safetySnapshot: this.frozenSafetySnapshot(),
      calibrated,
      querySnapshots,
    };
    this.windowedComments.set(candidate.traceId, processingComment);
    this.window.add(candidate, this.deps.nowMonotonic());
    this.maybeStartAttempt();
  }

  private maybeStartAttempt(): void {
    if (this.attempt !== null) return;
    // Stop in progress: never start a fresh attempt with a hardcoded default
    // cancel reason (MAJOR-A). startSession resets abortRequested.
    if (this.abortRequested) return;
    if (this.deps.stateMachine.getViewState().activity === 'DISPLAYING') return;
    const best = this.window.selectBest(this.deps.nowMonotonic());
    if (best === null) return;
    this.window.removeSelected(best.traceId);
    this.windowedComments.delete(best.traceId);
    // Full freshness deadline (CONTRACT §6): min of the t0 cap, the selection
    // budget, and the candidate's window residency (windowOpenedAt = t0).
    const now = this.deps.nowMonotonic();
    const t0 = best.processingComment.receivedMonotonicMs;
    const freshnessDeadlineMonotonicMs = Math.min(
      t0 + T0_FRESHNESS_BUDGET_MS,
      now + SELECTED_BUDGET_MS,
      t0 + (this.deps.windowMaxAgeMs ?? WINDOW_MAX_AGE_MS),
    );
    // Unify comment-level and attempt-level freshness on the same tightest bound
    // for the attempt's lifetime (M5-08).
    best.processingComment.freshnessDeadlineMonotonicMs = freshnessDeadlineMonotonicMs;
    const attempt: SuggestionAttempt = {
      traceId: best.traceId,
      sessionId: best.processingComment.sessionId,
      windowVersion: best.processingComment.windowVersion,
      abortController: new AbortController(),
      cancelReason: 'USER_STOPPED',
      freshnessDeadlineMonotonicMs,
      startedAtMonotonicMs: now,
      comment: best.processingComment,
      personaRoute: best.personaRoute,
      personaSnapshot: best.personaSnapshot,
      safetySnapshot: best.safetySnapshot,
      calibrated: best.calibrated,
      path: 'LLM',
      providerAuditRecord: null,
    };
    this.attempt = attempt;
    void this.runAttempt(best, attempt).catch((err) =>
      this.handlePipelineError(best.processingComment, err),
    );
  }

  private async runAttempt(candidate: PendingCandidate, attempt: SuggestionAttempt): Promise<void> {
    const direct = evaluateDirectPush(candidate.calibrated.mergedTopK, {
      personaId: candidate.personaSnapshot.personaId,
      personaVersion: candidate.personaSnapshot.personaVersion,
      directPushThreshold: this.frozenDirectPushThreshold ?? this.deps.directPushThreshold,
    });

    // Direct path (ARCH §4.3): only after the shared output validator passes.
    if (direct.eligible) {
      const top = candidate.calibrated.mergedTopK[0];
      if (top !== undefined && top.collection === 'golden_set') {
        const payload = top.payload as GoldenSetPayloadV1;
        const validation = this.deps.validator.validate(
          { quick_reply: payload.reply, cues: payload.cues },
          this.validationContext(candidate, attempt, 'retrieval_payload'),
        );
        if (validation.ok) {
          attempt.path = 'DIRECT';
          // t2 = local output validation complete (RESEARCH §6.1).
          const outputValidatedAtMonotonicMs = this.deps.nowMonotonic();
          this.transition(candidate.processingComment, 'RETRIEVING', 'DIRECT_READY', 'GOLDEN_DIRECT_ELIGIBLE', [
            ...candidate.querySnapshots,
            this.snap('SUGGESTION_JSON', 'DIRECT_PAYLOAD', { quick_reply: payload.reply, cues: payload.cues }),
            this.snap('DECISION_JSON', 'DIRECT_DECISION', direct),
          ]);
          if (!this.isAttemptFresh(attempt)) return this.cancelAttempt(attempt, attempt.cancelReason);
          this.transition(candidate.processingComment, 'DIRECT_READY', 'DISPLAY_READY', 'OUTPUT_VALIDATED', [
            this.snap('SUGGESTION_JSON', 'OUTPUT_VALIDATION', {
              validatorVersion: 'SuggestionOutputValidatorV1',
              ok: true,
              outputValidatedAtMonotonicMs,
            }),
            this.snap('DECISION_JSON', 'OUTPUT_SAFETY_DECISION', { allow: true }),
          ]);
          await this.display(attempt, validation.output);
          return;
        }
        // Direct validation failed → degrade to the LLM path (ARCH §4.3).
      }
    }

    // LLM path (ARCH §4.3): render prompt, one provider call. The attempt may
    // start from a fresh window candidate while activity is LISTENING, which
    // must hop through RETRIEVING to reach GENERATING (m-1).
    this.enterGenerating();
    const rendered = renderPrompt({
      targetComment: candidate.processingComment.normalizedText,
      personaSnapshot: candidate.personaSnapshot,
      safetySnapshot: candidate.safetySnapshot,
      mergedTopK: candidate.calibrated.mergedTopK,
      ...(this.deps.maxContextBudget !== undefined ? { maxContextBudget: this.deps.maxContextBudget } : {}),
      ...(this.frozenSystemPrompt !== null
        ? {
            systemPromptTemplate: this.frozenSystemPrompt.systemPromptTemplate,
            systemPromptTemplateVersion: this.frozenSystemPrompt.templateVersion,
          }
        : {}),
    });
    this.transition(candidate.processingComment, 'RETRIEVING', 'PROMPT_RENDERED', 'LLM_REQUIRED', [
      ...candidate.querySnapshots,
      // RENDERED_PROMPT (LLM §7): the actual system/user content and versions.
      this.snap('PROMPT_TEXT', 'RENDERED_PROMPT', {
        templateVersion: rendered.templateVersion,
        assemblerVersion: rendered.assemblerVersion,
        system: rendered.system,
        user: rendered.user,
        truncationLog: rendered.truncationLog,
        personaId: candidate.personaSnapshot.personaId,
        personaVersion: candidate.personaSnapshot.personaVersion,
        personaContentHmac: candidate.personaSnapshot.contentHmac,
        safetyVersion: candidate.safetySnapshot.version,
        topK: candidate.calibrated.mergedTopK.map((hit) => ({
          caseId: hit.caseId,
          collection: hit.collection,
        })),
      }),
    ]);

    // Resolve config/credential before entering LLM_PENDING so LLM_REQUEST_META
    // (which needs provider/model/baseUrl) rides on the LLM_PENDING transition.
    // A missing config/key still enters LLM_PENDING first and fails via
    // LLM_PENDING → FAILED (the only FAILED edge).
    const config = await this.deps.providerConfig.getProviderConfig();
    const configCancel = this.commentCancelled(candidate.processingComment);
    if (!configCancel.ok) return this.cancelAttempt(attempt, configCancel.reason);
    if (config === null) {
      this.transition(candidate.processingComment, 'PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED');
      this.fail(attempt, 'PROVIDER_FAILED');
      return;
    }
    const providerId = CredentialStore.parseCredentialRef(config.credentialRef);
    const apiKey = providerId === null ? null : await this.deps.credentials.getCredential(providerId);
    const keyCancel = this.commentCancelled(candidate.processingComment);
    if (!keyCancel.ok) return this.cancelAttempt(attempt, keyCancel.reason);
    if (apiKey === null) {
      this.transition(candidate.processingComment, 'PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED');
      this.fail(attempt, 'PROVIDER_FAILED');
      return;
    }

    const requestStartedAtMonotonicMs = this.deps.nowMonotonic();
    this.transition(candidate.processingComment, 'PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED', [
      // LLM_REQUEST_META (LLM §7): what the request was; never the API key/header.
      this.snap('PROVIDER_META_JSON', 'LLM_REQUEST_META', {
        providerId: config.providerId,
        adapterType: config.adapterType,
        baseUrlOrigin: new URL(config.baseUrl).origin,
        modelId: config.modelId,
        callMode: 'non-streaming-json',
        startedAtMonotonicMs: requestStartedAtMonotonicMs,
        freshnessDeadlineMonotonicMs: attempt.freshnessDeadlineMonotonicMs,
        sessionId: attempt.sessionId,
        windowVersion: attempt.windowVersion,
      }),
    ]);

    const provider = this.deps.createProvider(config.adapterType);
    this.deps.onLlmRequest?.();
    const llmStartedAt = this.deps.nowMonotonic();
    const result = await provider.generateReply({
      sessionId: candidate.processingComment.sessionId,
      traceId: candidate.processingComment.traceId,
      windowVersion: candidate.processingComment.windowVersion,
      providerId: config.providerId,
      adapterType: config.adapterType,
      baseUrl: config.baseUrl,
      modelId: config.modelId,
      messages: [
        { role: 'system', content: rendered.system },
        { role: 'user', content: rendered.user },
      ],
      apiKey,
      timeoutMs: PROVIDER_TIMEOUT_MS,
      freshnessDeadlineMonotonicMs: candidate.processingComment.freshnessDeadlineMonotonicMs,
      abortSignal: attempt.abortController.signal,
    });
    this.deps.onLlmCompleted?.(
      this.deps.nowMonotonic() - llmStartedAt,
      result.ok,
      result.ok ? undefined : result.error.code,
    );
    attempt.providerAuditRecord = provider.getAuditRecord();
    const responseCompletedAtMonotonicMs = this.deps.nowMonotonic();
    const postProvider = this.commentCancelled(candidate.processingComment);
    if (!postProvider.ok) return this.cancelAttempt(attempt, postProvider.reason);

    if (!result.ok) {
      if (result.error.code === 'ABORTED') {
        this.cancelAttempt(attempt, attempt.cancelReason);
      } else {
        this.fail(attempt, 'PROVIDER_FAILED');
      }
      return;
    }
    this.transition(candidate.processingComment, 'LLM_PENDING', 'GENERATED', 'PROVIDER_SUCCEEDED', [
      // LLM_RAW_RESPONSE + LLM_PARSED_OUTPUT (LLM §7): the received (key-scrubbed)
      // body and the parsed output that feeds the shared validator.
      this.snap('PROVIDER_RESPONSE_JSON', 'LLM_RAW_RESPONSE', {
        providerRequestId: attempt.providerAuditRecord?.providerRequestId,
        httpStatus: attempt.providerAuditRecord?.providerStatus,
        rawResponse: attempt.providerAuditRecord?.rawResponse,
        completedAtMonotonicMs: responseCompletedAtMonotonicMs,
      }),
      this.snap('SUGGESTION_JSON', 'LLM_PARSED_OUTPUT', {
        quickReply: result.output.quick_reply,
        cues: result.output.cues,
        parserVersion: 'SuggestionOutputV1',
      }),
    ]);

    const validation = this.deps.validator.validate(
      result.output,
      this.validationContext(candidate, attempt, 'llm'),
    );
    if (!validation.ok) {
      if (validation.kind === 'STALE') {
        this.cancelAttempt(attempt, validation.traceReason);
      } else {
        const reason: TraceReasonCodeV1 = validation.reasonCodes.includes('PERSONA_REVIEW_UNCERTAIN')
          ? 'PERSONA_REVIEW_UNCERTAIN'
          : 'OUTPUT_INVALID';
        this.discard(attempt, reason);
      }
      return;
    }
    // t2 = local output validation complete (RESEARCH §6.1).
    const outputValidatedAtMonotonicMs = this.deps.nowMonotonic();
    const postValidation = this.attemptFreshness(attempt);
    if (!postValidation.ok) return this.cancelAttempt(attempt, postValidation.reason);
    this.transition(candidate.processingComment, 'GENERATED', 'DISPLAY_READY', 'OUTPUT_VALIDATED', [
      this.snap('SUGGESTION_JSON', 'OUTPUT_VALIDATION', {
        validatorVersion: 'SuggestionOutputValidatorV1',
        ok: true,
        outputValidatedAtMonotonicMs,
      }),
      this.snap('DECISION_JSON', 'OUTPUT_SAFETY_DECISION', { allow: true }),
    ]);
    await this.display(attempt, validation.output);
  }

  private async display(attempt: SuggestionAttempt, output: ValidatedSuggestionV1): Promise<void> {
    const pre = this.attemptFreshness(attempt);
    if (!pre.ok) return this.cancelAttempt(attempt, pre.reason);
    this.enterDisplaying();
    // UI §5: the overlay shows @nickname + comment text beside the suggestion.
    // An empty nickname is the same as absent (no "@" placeholder line). The
    // comment sent time is pre-formatted here (createTime, receivedAt fallback).
    const sentAt = formatOverlaySentTime(attempt.comment.upstreamCreatedAt, attempt.comment.receivedAt);
    const payload: OverlayDisplayPayloadV1 = {
      comment: {
        nickname: attempt.comment.userNickname || undefined,
        text: attempt.comment.normalizedText,
        ...(sentAt !== undefined ? { sentAt } : {}),
      },
      suggestion: output,
    };
    const show = await this.deps.displaySink.show(payload, {
      sessionId: attempt.sessionId,
      traceId: attempt.traceId,
      windowVersion: attempt.windowVersion,
    });
    const post = this.attemptFreshness(attempt);
    if (!post.ok) return this.cancelAttempt(attempt, post.reason);
    if (show.ok) {
      this.transition(attempt.comment, 'DISPLAY_READY', 'DISPLAYED', 'OVERLAY_RENDERED', [
        this.snap('OVERLAY_RESULT_JSON', 'OVERLAY_RESULT', {
          firstFrameAtMonotonicMs: show.firstFrameAtMonotonicMs,
          // E2E = t_end - t0 (RESEARCH §6.1), recorded for T-PERF-001 replay.
          e2eMs: show.firstFrameAtMonotonicMs - attempt.comment.receivedMonotonicMs,
        }),
      ]);
      this.deps.onSuggestionResult?.(
        'displayed',
        show.firstFrameAtMonotonicMs - attempt.comment.receivedMonotonicMs,
      );
      // Display window: auto-hide after the configured duration; unref so a
      // pending timer never holds the process during tests/shutdown. UI §7:
      // the duration is read per display so preference changes apply next time.
      const displayDurationMs =
        (await this.deps.getDisplayDurationMs?.()) ??
        this.deps.displayDurationMs ??
        DISPLAY_DURATION_MS;
      // The duration read is a real suspension point: an abort may have closed
      // the attempt in between. Never arm a timer for a cleared attempt — it
      // would fire finishDisplay on a later trace (audit corruption + spurious
      // hide/resetWindowAfterDisplay on the next display). abortAll already hid
      // the overlay, so returning leaves nothing orphaned.
      if (this.attempt !== attempt) return;
      const timer = setTimeout(() => this.finishDisplay(), displayDurationMs);
      timer.unref?.();
      this.displayTimer = timer;
    } else {
      // Bump the window version first so the next candidate starts fresh; a
      // discard-then-bump would start a candidate already stale (m-6).
      this.resetWindowAfterDisplay();
      this.discard(attempt, 'SOURCE_ERROR');
    }
  }

  private fail(attempt: SuggestionAttempt, reason: TraceReasonCodeV1): void {
    this.deps.onSuggestionResult?.('failed');
    // Terminal from LLM_PENDING (the only FAILED edge).
    this.transition(attempt.comment, 'LLM_PENDING', 'FAILED', reason, [
      this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason }),
    ]);
    this.clearAttempt();
  }

  private discard(attempt: SuggestionAttempt, reason: TraceReasonCodeV1): void {
    this.deps.onSuggestionResult?.('discarded');
    // Close from the actual last written state (GENERATED / DISPLAY_READY / …).
    this.closeChain(attempt.comment, reason);
    this.clearAttempt();
  }

  /**
   * Freshness/cancel miss: close the trace to a terminal (DISCARDED) from its
   * actual last state and release the single-attempt mutex (ARCH §4.1).
   */
  private cancelAttempt(attempt: SuggestionAttempt, reason: CancelTraceReason): void {
    this.closeChain(attempt.comment, reason);
    this.clearAttempt();
  }

  private closeChain(comment: ProcessingComment, reason: TraceReasonCodeV1): void {
    const last = this.traceState.get(comment.traceId) ?? 'RECEIVED';
    switch (last) {
      case 'RECEIVED':
        this.transition(comment, 'RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK');
        this.transition(comment, 'NORMALIZED', 'DISCARDED', reason, [
          this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason }),
        ]);
        return;
      case 'NORMALIZED':
      case 'RETRIEVING':
      case 'LLM_PENDING':
      case 'GENERATED':
      case 'DISPLAY_READY':
        this.transition(comment, last, 'DISCARDED', reason, [
          this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason }),
        ]);
        return;
      case 'ROUTED':
        this.transition(comment, 'ROUTED', 'RETRIEVING', 'RETRIEVAL_STARTED');
        this.transition(comment, 'RETRIEVING', 'DISCARDED', reason, [
          this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason }),
        ]);
        return;
      case 'DIRECT_READY':
        this.transition(comment, 'DIRECT_READY', 'DISPLAY_READY', 'OUTPUT_VALIDATED');
        this.transition(comment, 'DISPLAY_READY', 'DISCARDED', reason, [
          this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason }),
        ]);
        return;
      case 'PROMPT_RENDERED':
        this.transition(comment, 'PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED');
        this.transition(comment, 'LLM_PENDING', 'DISCARDED', reason, [
          this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason }),
        ]);
        return;
      case 'DISPLAYED':
        this.transition(comment, 'DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED', [
          this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason: 'DISPLAY_DURATION_ELAPSED' }),
        ]);
        return;
      case 'FILTERED':
      case 'HIDDEN':
      case 'DISCARDED':
      case 'FAILED':
        return; // already terminal
    }
  }

  private clearAttempt(): void {
    // A stale display timer must never hide the next display (M5-08).
    this.clearDisplayTimer();
    this.attempt = null;
    // After a stop, the lifecycle is STOPPED and only IDLE is allowed; do not
    // try to flip activity to LISTENING (ServiceStateInvalidTransitionError).
    if (this.deps.stateMachine.getViewState().lifecycle === 'RUNNING') {
      this.deps.stateMachine.setActivity('LISTENING');
      this.maybeStartAttempt();
    }
  }

  private clearDisplayTimer(): void {
    if (this.displayTimer !== null) {
      clearTimeout(this.displayTimer);
      this.displayTimer = null;
    }
  }

  /** Return to LISTENING after a pre-attempt candidate path fails (MAJOR-2). */
  private restoreListening(): void {
    if (this.deps.stateMachine.getViewState().lifecycle === 'RUNNING') {
      this.deps.stateMachine.setActivity('LISTENING');
      this.maybeStartAttempt();
    }
  }

  // Activity is a DAG: LISTENING → RETRIEVING → GENERATING/DISPLAYING → LISTENING.
  // An attempt started from a windowed candidate (after clearAttempt reset the
  // activity to LISTENING) must hop through RETRIEVING to reach GENERATING or
  // DISPLAYING; direct setActivity('GENERATING') from LISTENING is illegal.
  private enterRetrieving(): void {
    if (this.deps.stateMachine.getViewState().activity === 'LISTENING') {
      this.deps.stateMachine.setActivity('RETRIEVING');
    }
  }

  private enterGenerating(): void {
    this.enterRetrieving();
    const activity = this.deps.stateMachine.getViewState().activity;
    if (activity === 'RETRIEVING') this.deps.stateMachine.setActivity('GENERATING');
  }

  private enterDisplaying(): void {
    this.enterRetrieving();
    const activity = this.deps.stateMachine.getViewState().activity;
    if (activity === 'RETRIEVING' || activity === 'GENERATING') {
      this.deps.stateMachine.setActivity('DISPLAYING');
    }
  }

  /** Reset the window after a display ended (or was refused), bumping the version. */
  private resetWindowAfterDisplay(): void {
    this.window.clear();
    this.window.bumpVersion();
  }

  /**
   * WP-2 FIFO drain on display end: expire stale queued comments (QUEUE_TIMEOUT)
   * and promote the oldest fresh one — re-anchoring its window version and
   * freshness at promotion time so the attempt budget starts fresh. The rest
   * stay queued for the next display end.
   */
  private drainQueue(): void {
    if (!this.frozenQueueing?.enabled || this.pendingQueue.length === 0) return;
    const now = this.deps.nowMonotonic();
    const remaining: ProcessingComment[] = [];
    for (const comment of this.pendingQueue) {
      if (now - comment.receivedMonotonicMs > this.frozenQueueing.timeoutMs) {
        this.closeChain(comment, 'QUEUE_TIMEOUT');
        continue;
      }
      remaining.push(comment);
    }
    this.pendingQueue = remaining;
    const promoted = this.pendingQueue.shift();
    if (promoted === undefined) return;
    promoted.windowVersion = this.window.version;
    promoted.receivedMonotonicMs = now;
    promoted.freshnessDeadlineMonotonicMs =
      now + Math.min(T0_FRESHNESS_BUDGET_MS, this.deps.windowMaxAgeMs ?? WINDOW_MAX_AGE_MS);
    this.continueFromNormalized(promoted);
  }

  /** Close every queued comment's trace so none dangles in NORMALIZED. */
  private closePendingQueue(reason: TraceReasonCodeV1): void {
    for (const comment of this.pendingQueue) {
      this.closeChain(comment, reason);
    }
    this.pendingQueue = [];
  }

  private validationContext(
    candidate: PendingCandidate,
    attempt: SuggestionAttempt,
    source: 'llm' | 'retrieval_payload',
  ): OutputValidationContext {
    const session = this.session;
    return {
      source,
      personaSnapshot: candidate.personaSnapshot,
      safetySnapshot: candidate.safetySnapshot,
      compiledRules: this.frozenSafety?.compiledRules ?? null,
      riskFilter: this.frozenRiskFilter,
      memberNames: this.frozenMembers,
      currentPersonaId: candidate.personaSnapshot.personaId,
      forbiddenPromiseTerms: [],
      expected: {
        sessionId: attempt.sessionId,
        traceId: attempt.traceId,
        windowVersion: attempt.windowVersion,
      },
      actual: {
        sessionId: session?.sessionId ?? attempt.sessionId,
        traceId: attempt.traceId,
        windowVersion: this.window.version,
      },
      nowMonotonicMs: this.deps.nowMonotonic(),
      freshnessDeadlineMonotonicMs: attempt.freshnessDeadlineMonotonicMs,
      abortSignal: attempt.abortController.signal,
    };
  }

  /** Freshness verdict with the concrete trace reason (ARCH §4.1). */
  private attemptFreshness(attempt: SuggestionAttempt): { ok: true } | { ok: false; reason: CancelTraceReason } {
    if (attempt.abortController.signal.aborted || this.abortRequested) {
      return { ok: false, reason: attempt.cancelReason };
    }
    if (this.session === null || attempt.sessionId !== this.session.sessionId) {
      return { ok: false, reason: 'STALE_SESSION' };
    }
    if (attempt.windowVersion !== this.window.version) {
      return { ok: false, reason: 'STALE_WINDOW' };
    }
    if (this.deps.nowMonotonic() > attempt.freshnessDeadlineMonotonicMs) {
      return { ok: false, reason: 'DEADLINE_EXCEEDED' };
    }
    return { ok: true };
  }

  private isAttemptFresh(attempt: SuggestionAttempt): boolean {
    return this.attemptFreshness(attempt).ok;
  }

  /** Cancellation verdict with the concrete trace reason (ARCH §4.1). */
  private commentCancelled(comment: ProcessingComment): { ok: true } | { ok: false; reason: CancelTraceReason } {
    if (this.abortRequested) return { ok: false, reason: 'USER_STOPPED' };
    if (this.session === null || comment.sessionId !== this.session.sessionId) {
      return { ok: false, reason: 'STALE_SESSION' };
    }
    if (comment.windowVersion !== this.window.version) {
      return { ok: false, reason: 'STALE_WINDOW' };
    }
    if (this.deps.nowMonotonic() > comment.freshnessDeadlineMonotonicMs) {
      return { ok: false, reason: 'DEADLINE_EXCEEDED' };
    }
    return { ok: true };
  }

  private isCancelled(comment: ProcessingComment): boolean {
    return !this.commentCancelled(comment).ok;
  }

  private frozenSafetySnapshot(): { version: string; policyText: string; keywords: string[] } {
    return this.frozenSafety
      ? {
          version: this.frozenSafety.version,
          policyText: this.frozenSafety.policyText,
          keywords: this.frozenSafety.keywords,
        }
      : { version: 'unknown', policyText: '', keywords: [] };
  }

  // WP-4: the run-page semantic-discard threshold overrides only the confidence
  // field; the rest of the calibration artifact keeps its code/default weights.
  private effectiveCalibrationArtifact(): CalibrationArtifactV1 {
    const base = this.deps.calibrationArtifact ?? DEFAULT_CALIBRATION_ARTIFACT_V1;
    return this.frozenSemanticDiscardConfidence === null
      ? base
      : { ...base, semanticDiscardConfidence: this.frozenSemanticDiscardConfidence };
  }

  /**
   * Insert the audit trace for a comment. Returns false when the message was
   * already audited (a duplicate slipped past the bounded seen set) or the
   * audit store is down; the caller drops the comment without further writes
   * so no dangling FK transitions are attempted.
   */
  private beginTrace(comment: ProcessingComment): boolean {
    if (this.auditDown) return false;
    try {
      this.deps.audit.createTrace({
        traceId: comment.traceId,
        sessionId: comment.sessionId,
        sourceMessageId: comment.sourceMessageId,
        receivedAt: comment.receivedAt,
      });
      return true;
    } catch (err) {
      if (err instanceof AuditDuplicateTraceError) return false;
      if (err instanceof AuditUnavailableError) {
        this.auditDown = true;
        this.abortRequested = true;
        this.abortAll('AUDIT_FAILURE');
        this.deps.onAuditFailure();
        return false;
      }
      throw err;
    }
  }

  /** Bound the seen-set by evicting the oldest half; recent ids stay deduped. */
  private evictSeenHalf(): void {
    const seen = this.session?.seen;
    if (seen === undefined) return;
    const target = Math.floor(SEEN_SET_MAX / 2);
    let removed = seen.size - target;
    for (const id of seen) {
      if (removed <= 0) break;
      seen.delete(id);
      removed -= 1;
    }
  }

  private transition(
    comment: ProcessingComment,
    from: TraceState | null,
    to: TraceState,
    reason: TraceReasonCodeV1,
    snapshots: AuditSnapshotInput[] = [],
  ): void {
    this.tryAudit(() => {
      this.deps.audit.appendTransition(comment.traceId, from, to, reason, snapshots);
      this.traceState.set(comment.traceId, to);
    });
  }

  private snap(
    contentType: AuditContentTypeV1,
    role: AuditSnapshotRoleV1,
    payload: unknown,
  ): AuditSnapshotInput {
    return {
      snapshotId: uuidv7(),
      contentType,
      role,
      plaintext: Buffer.from(JSON.stringify(payload)),
    };
  }

  private tryAudit(fn: () => void): void {
    if (this.auditDown) return;
    try {
      fn();
    } catch (err) {
      if (err instanceof AuditUnavailableError) {
        this.auditDown = true;
        this.abortRequested = true;
        this.abortAll('AUDIT_FAILURE');
        this.deps.onAuditFailure();
        return;
      }
      throw err;
    }
  }

  private handlePipelineError(comment: ProcessingComment, err: unknown): void {
    // AuditUnavailableError is always swallowed inside tryAudit (which triggers
    // abortAll + onAuditFailure), so it never reaches here; this branch is a
    // defensive no-op rather than a second audit attempt.
    if (err instanceof AuditUnavailableError) return;
    // Close the trace from its actual last state; never write an illegal edge
    // or leave a dangling chain (CR-4 fix).
    const last = this.traceState.get(comment.traceId) ?? 'RECEIVED';
    if (last === 'FILTERED' || last === 'HIDDEN' || last === 'DISCARDED' || last === 'FAILED') {
      return;
    }
    if (last === 'DISPLAYED') {
      this.transition(comment, 'DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED', [
        this.snap('FINAL_REASON_JSON', 'FINAL_REASON', { reason: 'DISPLAY_DURATION_ELAPSED' }),
      ]);
      return;
    }
    this.closeChain(comment, 'LOW_VALUE');
    // Only release the mutex when the failing comment is the current attempt; a
    // background candidate's error must not clear a genuinely in-flight attempt
    // (MINOR-1).
    if (this.attempt === null || this.attempt.traceId === comment.traceId) {
      this.clearAttempt();
    }
  }
}
