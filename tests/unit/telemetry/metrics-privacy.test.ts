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

  it('provider errors counter uses error_type label only', async () => {
    const m = new EchocueMetrics()
    m.providerErrors.inc({ error_type: 'TIMEOUT' })
    const text = await m.metricsText()
    expect(text).toContain('error_type="TIMEOUT"')
    expect(text).not.toContain('provider_id')
    expect(text).not.toContain('model_id')
  })
})
