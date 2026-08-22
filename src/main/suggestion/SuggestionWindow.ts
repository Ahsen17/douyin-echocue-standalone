import type { PendingCandidate, WindowSummary } from './types.js';

export interface SuggestionWindowOptions {
  windowMaxAgeMs: number;
  candidateMaxCount: number;
  /** Called for every candidate that leaves the window without being selected. */
  onEvict?: (traceId: string) => void;
}

/**
 * Latest rolling window (ARCH §4.1): holds safe candidate summaries within
 * windowMaxAgeMs, capped by candidateMaxCount, and tracks windowVersion.
 * Cleared when a display ends (windowVersion++), never while an attempt lives.
 * Every eviction (age/cap/clear) reports the traceId via onEvict so the
 * orchestrator can close the candidate's audit chain (MAJOR-1).
 */
export class SuggestionWindow {
  private readonly maxAgeMs: number;
  private readonly maxCount: number;
  private readonly onEvict: ((traceId: string) => void) | undefined;
  private windowVersion = 0;
  private readonly candidates = new Map<string, PendingCandidate>();

  constructor(options: SuggestionWindowOptions) {
    this.maxAgeMs = options.windowMaxAgeMs;
    this.maxCount = options.candidateMaxCount;
    this.onEvict = options.onEvict;
  }

  getSummary(nowMonotonicMs: number): WindowSummary {
    this.evictExpired(nowMonotonicMs);
    return {
      windowVersion: this.windowVersion,
      openedAtMonotonicMs: 0,
      candidates: new Map(this.candidates),
    };
  }

  add(candidate: PendingCandidate, nowMonotonicMs: number): void {
    this.evictExpired(nowMonotonicMs);
    this.candidates.set(candidate.traceId, candidate);
    // Bound the window by count; drop the lowest-priority entry beyond the cap.
    while (this.candidates.size > this.maxCount) {
      const lowest = [...this.candidates.values()].reduce((a, b) =>
        b.priority < a.priority ? b : a,
      );
      this.onEvict?.(lowest.traceId);
      this.candidates.delete(lowest.traceId);
    }
  }

  /** Best candidate (max priority) among the non-expired, else null. */
  selectBest(nowMonotonicMs: number): PendingCandidate | null {
    this.evictExpired(nowMonotonicMs);
    let best: PendingCandidate | null = null;
    for (const candidate of this.candidates.values()) {
      if (best === null || candidate.priority > best.priority) best = candidate;
    }
    return best;
  }

  remove(traceId: string): void {
    this.candidates.delete(traceId);
  }

  /** Remove without reporting (a candidate selected for an attempt). */
  removeSelected(traceId: string): void {
    this.candidates.delete(traceId);
  }

  clear(): void {
    for (const traceId of this.candidates.keys()) {
      this.onEvict?.(traceId);
    }
    this.candidates.clear();
  }

  bumpVersion(): void {
    this.windowVersion += 1;
  }

  get version(): number {
    return this.windowVersion;
  }

  get size(): number {
    return this.candidates.size;
  }

  private evictExpired(nowMonotonicMs: number): void {
    for (const [traceId, candidate] of this.candidates) {
      if (nowMonotonicMs - candidate.receivedMonotonicMs > this.maxAgeMs) {
        this.onEvict?.(traceId);
        this.candidates.delete(traceId);
      }
    }
  }
}
