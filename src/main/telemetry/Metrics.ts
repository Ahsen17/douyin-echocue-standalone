import { Registry, Counter, Histogram } from 'prom-client'

export class EchocueMetrics {
  readonly registry: Registry
  readonly commentReceived: Counter<string>
  readonly commentFiltered: Counter<'category'>
  readonly providerRequests: Counter<string>
  readonly providerErrors: Counter<'error_type'>
  readonly e2eLatencyMs: Histogram<string>
  readonly overlayDisplayed: Counter<string>
  readonly sidecarCrashes: Counter<string>

  constructor() {
    this.registry = new Registry()

    this.commentReceived = new Counter({
      name: 'echocue_comment_received_total',
      help: 'Total comments received from WebSocket',
      registers: [this.registry],
    })

    this.commentFiltered = new Counter({
      name: 'echocue_comment_filtered_total',
      help: 'Total comments filtered by safety rules',
      labelNames: ['category'] as const,
      registers: [this.registry],
    })

    this.providerRequests = new Counter({
      name: 'echocue_provider_requests_total',
      help: 'Total LLM provider requests',
      registers: [this.registry],
    })

    this.providerErrors = new Counter({
      name: 'echocue_provider_errors_total',
      help: 'Total LLM provider errors by type',
      labelNames: ['error_type'] as const,
      registers: [this.registry],
    })

    this.e2eLatencyMs = new Histogram({
      name: 'echocue_e2e_latency_ms',
      help: 'End-to-end latency from WS frame to overlay first render (ms)',
      buckets: [100, 250, 500, 1000, 1500, 2000, 3000, 5000],
      registers: [this.registry],
    })

    this.overlayDisplayed = new Counter({
      name: 'echocue_overlay_display_total',
      help: 'Total overlay suggestion displays',
      registers: [this.registry],
    })

    this.sidecarCrashes = new Counter({
      name: 'echocue_sidecar_crash_total',
      help: 'Total sidecar process crashes detected',
      registers: [this.registry],
    })
  }

  async metricsText(): Promise<string> {
    return this.registry.metrics()
  }
}
