import type { ServiceLifecycle, ServiceActivity, DomainErrorV1 } from '@echocue/contracts'

export interface DiagnosticSummary {
  lifecycle: ServiceLifecycle
  activity: ServiceActivity
  lastCommentReceivedAt?: string
  lastSuggestionAt?: string
  lastSuggestionResult?: 'displayed' | 'filtered' | 'discarded' | 'failed'
  lastE2eLatencyMs?: number
  lastDomainError?: DomainErrorV1
}

export class DiagnosticsSource {
  private summary: DiagnosticSummary = {
    lifecycle: 'STOPPED',
    activity: 'IDLE',
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
    if (e2eLatencyMs !== undefined) {
      this.summary.lastE2eLatencyMs = e2eLatencyMs
    }
  }

  recordDomainError(code: DomainErrorV1): void {
    this.summary.lastDomainError = code
  }

  getSummary(): Readonly<DiagnosticSummary> {
    return { ...this.summary }
  }
}
