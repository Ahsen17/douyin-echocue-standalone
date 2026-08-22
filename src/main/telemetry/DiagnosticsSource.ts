import type { ServiceLifecycle, ServiceActivity, DomainErrorV1 } from '@echocue/contracts'

export interface DiagnosticSummary {
  lifecycle: ServiceLifecycle
  activity: ServiceActivity
  lastCommentReceivedAt?: string
  lastSuggestionAt?: string
  lastSuggestionResult?: 'displayed' | 'filtered' | 'discarded' | 'failed'
  lastE2eLatencyMs?: number
  lastDomainError?: DomainErrorV1
  storageAvailableBytes?: number
  storageLowSpace?: boolean
}

export interface StorageCapacity {
  availableBytes: number
  totalBytes: number
}

// RUNBOOK §4.1 low-space warning: below 1 GiB or 10% of the volume (higher wins).
const LOW_SPACE_MIN_BYTES = 1024 * 1024 * 1024
const LOW_SPACE_RATIO = 0.1

export interface DiagnosticsSourceOptions {
  /** Optional volume capacity read; when absent the summary omits storage. */
  readStorage?: () => StorageCapacity | null
}

export class DiagnosticsSource {
  private summary: DiagnosticSummary = {
    lifecycle: 'STOPPED',
    activity: 'IDLE',
  }
  private readonly readStorage: (() => StorageCapacity | null) | undefined

  constructor(options: DiagnosticsSourceOptions = {}) {
    this.readStorage = options.readStorage
  }

  updateLifecycle(lifecycle: ServiceLifecycle, activity: ServiceActivity): void {
    this.summary.lifecycle = lifecycle
    this.summary.activity = activity
  }

  recordCommentReceived(): void {
    this.summary.lastCommentReceivedAt = new Date().toISOString()
  }

  recordSuggestion(
    result: DiagnosticSummary['lastSuggestionResult'],
    e2eLatencyMs?: number,
  ): void {
    this.summary.lastSuggestionAt = new Date().toISOString()
    this.summary.lastSuggestionResult = result
    // E2E only applies to a displayed suggestion; a filtered/discarded/failed
    // result must not keep a stale latency from a previous display.
    this.summary.lastE2eLatencyMs =
      result === 'displayed' && e2eLatencyMs !== undefined ? e2eLatencyMs : undefined
  }

  recordDomainError(code: DomainErrorV1): void {
    this.summary.lastDomainError = code
  }

  getSummary(): Readonly<DiagnosticSummary> {
    const summary = { ...this.summary }
    const storage = this.readStorage?.()
    if (storage !== undefined && storage !== null) {
      summary.storageAvailableBytes = storage.availableBytes
      const threshold = Math.max(LOW_SPACE_MIN_BYTES, storage.totalBytes * LOW_SPACE_RATIO)
      // UI §8.1: warn but never auto-delete. Kept separate from lastDomainError
      // so a low-space warning never masks the real latest domain error.
      summary.storageLowSpace = storage.availableBytes < threshold
    }
    return summary
  }
}
