import { describe, it, expect } from 'vitest'
import { EchocueMetrics } from '../../../src/main/telemetry/Metrics.js'

describe('EchocueMetrics privacy constraints', () => {
  it('registry has no sensitive label names', async () => {
    const m = new EchocueMetrics()
    const text = await m.metricsText()
    expect(text).not.toContain('trace_id')
    expect(text).not.toContain('user_id')
    expect(text).not.toContain('nickname')
    expect(text).not.toContain('persona')
    expect(text).not.toContain('api_key')
  })

  it('filtered counter uses enum category labels only', async () => {
    const m = new EchocueMetrics()
    m.commentFiltered.inc({ category: 'ABUSE' })
    const text = await m.metricsText()
    expect(text).toContain('echocue_comment_filtered_total')
    expect(text).not.toContain('弹幕')
    expect(text).not.toContain('nickname')
  })

  it('LLM errors counter uses error_type label only', async () => {
    const m = new EchocueMetrics()
    m.llmErrors.inc({ error_type: 'TIMEOUT' })
    const text = await m.metricsText()
    expect(text).toContain('error_type="TIMEOUT"')
    expect(text).not.toContain('provider_id')
    expect(text).not.toContain('model_id')
  })

  it('semantic type counter uses enum category labels only', async () => {
    const m = new EchocueMetrics()
    m.commentSemanticType.inc({ semantic_type: 'persona_relevant' })
    m.commentDiscarded.inc({ reason: 'LOW_VALUE' })
    const text = await m.metricsText()
    expect(text).toContain('semantic_type="persona_relevant"')
    expect(text).toContain('reason="LOW_VALUE"')
    expect(text).not.toContain('弹幕')
  })

  it('exposes the WP-1 business + latency metric names', async () => {
    const m = new EchocueMetrics()
    m.commentReceived.inc()
    m.suggestionResult.inc({ result: 'displayed' })
    m.overlayDisplayed.inc()
    m.llmRequests.inc()
    m.llmLatencyMs.observe(1000)
    m.retrievalLatencyMs.observe(80)
    const text = await m.metricsText()
    expect(text).toContain('echocue_comment_received_total')
    expect(text).toContain('echocue_suggestion_result_total')
    expect(text).toContain('echocue_overlay_display_total')
    expect(text).toContain('echocue_llm_requests_total')
    expect(text).toContain('echocue_llm_latency_ms')
    expect(text).toContain('echocue_retrieval_latency_ms')
  })
})
