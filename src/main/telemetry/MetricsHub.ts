import type { SessionMetricsSnapshotV1 } from '@echocue/contracts';
import { EchocueMetrics } from './Metrics.js';
import { SessionMetrics } from './SessionMetrics.js';
import { createMetricsServer, type MetricsServerHandle } from './metrics-server.js';

export interface MetricsHubOptions {
  metrics?: EchocueMetrics;
  session?: SessionMetrics;
  /** null when the /metrics HTTP endpoint is disabled in settings. */
  server?: MetricsServerHandle | null;
}

/**
 * Observability facade wiring the Prometheus registry + per-session counters to
 * the orchestrator hooks. All labels are enum categories only (privacy red line).
 */
export class MetricsHub {
  readonly metrics: EchocueMetrics;
  readonly session: SessionMetrics;
  private readonly server: MetricsServerHandle | null;

  constructor(options: MetricsHubOptions = {}) {
    this.metrics = options.metrics ?? new EchocueMetrics();
    this.session = options.session ?? new SessionMetrics();
    this.server = options.server ?? null;
  }

  startServer(): void {
    this.server?.start();
  }

  stopServer(): Promise<void> {
    return this.server?.stop() ?? Promise.resolve();
  }

  resetSession(sessionId: string): void {
    this.session.reset(sessionId);
  }

  freezeSession(): void {
    this.session.freeze();
  }

  sessionSnapshot(): Readonly<SessionMetricsSnapshotV1> {
    return this.session.snapshot();
  }

  recordCommentReceived(): void {
    this.metrics.commentReceived.inc();
    this.session.recordCommentReceived();
  }

  recordCommentFiltered(category: string): void {
    this.metrics.commentFiltered.inc({ category });
    this.session.recordCommentFiltered();
  }

  recordSemanticType(type: string): void {
    this.metrics.commentSemanticType.inc({ semantic_type: type });
    this.session.recordSemanticType(type);
  }

  recordDiscarded(reason: string): void {
    this.metrics.commentDiscarded.inc({ reason });
  }

  recordRetrievalCompleted(latencyMs: number): void {
    this.metrics.retrievalLatencyMs.observe(latencyMs);
  }

  recordLlmRequest(): void {
    this.metrics.llmRequests.inc();
    this.session.recordLlmRequest();
  }

  recordLlmCompleted(latencyMs: number, ok: boolean, errorType?: string): void {
    this.metrics.llmLatencyMs.observe(latencyMs);
    if (!ok && errorType !== undefined) {
      this.metrics.llmErrors.inc({ error_type: errorType });
    }
    this.session.recordLlmLatency(latencyMs);
  }

  recordSuggestionResult(
    result: 'displayed' | 'filtered' | 'discarded' | 'failed',
    e2eLatencyMs?: number,
  ): void {
    this.metrics.suggestionResult.inc({ result });
    this.session.recordSuggestionResult(result);
    if (result === 'displayed') {
      this.metrics.overlayDisplayed.inc();
      if (e2eLatencyMs !== undefined) {
        this.metrics.e2eLatencyMs.observe(e2eLatencyMs);
        this.session.recordE2e(e2eLatencyMs);
      }
    }
  }

  recordSidecarCrash(kind: string): void {
    this.metrics.sidecarCrashes.inc({ kind });
  }
}
