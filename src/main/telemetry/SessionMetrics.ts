import type { SessionMetricsSnapshotV1 } from '@echocue/contracts';

// Bounded latency sample for the P95 estimate; a long session truncates the
// tail rather than growing memory without limit.
const E2E_SAMPLE_MAX = 50_000;

const EMPTY_SNAPSHOT: SessionMetricsSnapshotV1 = {
  commentReceived: 0,
  commentFiltered: 0,
  semanticTypeCounts: {},
  llmRequests: 0,
  displayed: 0,
  filtered: 0,
  discarded: 0,
  failed: 0,
};

function p95(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

/**
 * Per-live-session counters feeding the monitoring section. reset() on service
 * start, freeze() on service stop so the UI always shows the most recent run.
 * No comment text, persona text, keys, or trace ids are stored.
 */
export class SessionMetrics {
  private current: SessionMetricsSnapshotV1 | null = null;
  private last: SessionMetricsSnapshotV1 | null = null;
  private llmSum = 0;
  private llmCount = 0;
  private e2eLatencies: number[] = [];

  reset(sessionId: string): void {
    this.current = {
      ...EMPTY_SNAPSHOT,
      sessionId,
      startedAt: new Date().toISOString(),
    };
    this.llmSum = 0;
    this.llmCount = 0;
    this.e2eLatencies = [];
  }

  freeze(): void {
    if (this.current === null) return;
    this.current.endedAt = new Date().toISOString();
    this.last = this.current;
    this.current = null;
    this.llmSum = 0;
    this.llmCount = 0;
    this.e2eLatencies = [];
  }

  snapshot(): Readonly<SessionMetricsSnapshotV1> {
    const base = this.current ?? this.last ?? EMPTY_SNAPSHOT;
    return { ...base, semanticTypeCounts: { ...base.semanticTypeCounts } };
  }

  recordCommentReceived(): void {
    if (this.current === null) return;
    this.current.commentReceived += 1;
  }

  recordCommentFiltered(): void {
    if (this.current === null) return;
    this.current.commentFiltered += 1;
  }

  recordSemanticType(type: string): void {
    if (this.current === null) return;
    this.current.semanticTypeCounts[type] = (this.current.semanticTypeCounts[type] ?? 0) + 1;
  }

  recordLlmRequest(): void {
    if (this.current === null) return;
    this.current.llmRequests += 1;
  }

  recordLlmLatency(ms: number): void {
    if (this.current === null || !Number.isFinite(ms)) return;
    this.llmSum += ms;
    this.llmCount += 1;
    this.current.llmAvgLatencyMs = this.llmSum / this.llmCount;
  }

  recordE2e(ms: number): void {
    if (this.current === null || !Number.isFinite(ms)) return;
    if (this.e2eLatencies.length < E2E_SAMPLE_MAX) this.e2eLatencies.push(ms);
    this.current.e2eP95Ms = p95(this.e2eLatencies);
  }

  recordSuggestionResult(result: 'displayed' | 'filtered' | 'discarded' | 'failed'): void {
    if (this.current === null) return;
    switch (result) {
      case 'displayed': this.current.displayed += 1; break;
      case 'filtered': this.current.filtered += 1; break;
      case 'discarded': this.current.discarded += 1; break;
      case 'failed': this.current.failed += 1; break;
    }
  }
}
