import { Registry, Counter, Histogram } from 'prom-client'

/**
 * Prometheus metrics registry (ARCH §8 / TD-03). All labels are enum categories
 * only — never comment text, nicknames, persona text, provider ids, request ids,
 * or keys. The same events also feed SessionMetrics for the per-run UI snapshot.
 */
export class EchocueMetrics {
  readonly registry: Registry
  readonly commentReceived: Counter<string>
  readonly commentFiltered: Counter<'category'>
  readonly commentSemanticType: Counter<'semantic_type'>
  readonly commentDiscarded: Counter<'reason'>
  readonly suggestionResult: Counter<'result'>
  readonly overlayDisplayed: Counter<string>
  readonly llmRequests: Counter<string>
  readonly llmErrors: Counter<'error_type'>
  readonly sidecarCrashes: Counter<string>
  readonly llmLatencyMs: Histogram<string>
  readonly e2eLatencyMs: Histogram<string>
  readonly retrievalLatencyMs: Histogram<string>

  constructor() {
    this.registry = new Registry()

    this.commentReceived = new Counter({
      name: 'echocue_comment_received_total',
      help: 'Total chat-message danmaku received from the WebSocket',
      registers: [this.registry],
    })

    this.commentFiltered = new Counter({
      name: 'echocue_comment_filtered_total',
      help: 'Total comments filtered by safety/risk rules by category',
      labelNames: ['category'] as const,
      registers: [this.registry],
    })

    this.commentSemanticType = new Counter({
      name: 'echocue_comment_semantic_type_total',
      help: 'Final semantic type per processed comment',
      labelNames: ['semantic_type'] as const,
      registers: [this.registry],
    })

    this.commentDiscarded = new Counter({
      name: 'echocue_comment_discarded_total',
      help: 'Total comments discarded by reason',
      labelNames: ['reason'] as const,
      registers: [this.registry],
    })

    this.suggestionResult = new Counter({
      name: 'echocue_suggestion_result_total',
      help: 'Total suggestion outcomes',
      labelNames: ['result'] as const,
      registers: [this.registry],
    })

    this.overlayDisplayed = new Counter({
      name: 'echocue_overlay_display_total',
      help: 'Total overlay suggestion displays',
      registers: [this.registry],
    })

    this.llmRequests = new Counter({
      name: 'echocue_llm_requests_total',
      help: 'Total LLM provider requests',
      registers: [this.registry],
    })

    this.llmErrors = new Counter({
      name: 'echocue_llm_errors_total',
      help: 'Total LLM provider errors by type',
      labelNames: ['error_type'] as const,
      registers: [this.registry],
    })

    this.sidecarCrashes = new Counter({
      name: 'echocue_sidecar_crash_total',
      help: 'Total sidecar process crashes detected',
      labelNames: ['kind'] as const,
      registers: [this.registry],
    })

    this.llmLatencyMs = new Histogram({
      name: 'echocue_llm_latency_ms',
      help: 'LLM single-request latency (ms)',
      buckets: [100, 250, 500, 1000, 2000, 3000, 5000, 10000],
      registers: [this.registry],
    })

    this.e2eLatencyMs = new Histogram({
      name: 'echocue_e2e_latency_ms',
      help: 'End-to-end latency from WS frame to overlay first render (ms)',
      buckets: [100, 250, 500, 1000, 1500, 2000, 3000, 5000],
      registers: [this.registry],
    })

    this.retrievalLatencyMs = new Histogram({
      name: 'echocue_retrieval_latency_ms',
      help: 'Qdrant dual-collection retrieval latency (ms)',
      buckets: [50, 100, 150, 250, 500, 1000, 2000],
      registers: [this.registry],
    })
  }

  async metricsText(): Promise<string> {
    return this.registry.metrics()
  }
}
