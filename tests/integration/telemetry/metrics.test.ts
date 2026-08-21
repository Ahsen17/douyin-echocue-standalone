import { describe, it, expect, beforeEach } from 'vitest'
import { EchocueMetrics } from '../../../src/main/telemetry/Metrics.js'
import { DiagnosticsSource } from '../../../src/main/telemetry/DiagnosticsSource.js'
import { Logger } from '../../../src/main/telemetry/Logger.js'

describe('EchocueMetrics', () => {
  let m: EchocueMetrics

  beforeEach(() => { m = new EchocueMetrics() })

  it('comment received counter increments', async () => {
    m.commentReceived.inc()
    m.commentReceived.inc()
    const text = await m.metricsText()
    expect(text).toContain('echocue_comment_received_total 2')
  })

  it('e2e latency histogram records observations', async () => {
    m.e2eLatencyMs.observe(850)
    m.e2eLatencyMs.observe(1200)
    const text = await m.metricsText()
    expect(text).toContain('echocue_e2e_latency_ms')
    expect(text).toContain('echocue_e2e_latency_ms_count 2')
  })

  it('overlay display counter increments', async () => {
    m.overlayDisplayed.inc()
    const text = await m.metricsText()
    expect(text).toContain('echocue_overlay_display_total 1')
  })

  it('sidecar crash counter increments', async () => {
    m.sidecarCrashes.inc()
    const text = await m.metricsText()
    expect(text).toContain('echocue_sidecar_crash_total 1')
  })
})

describe('DiagnosticsSource', () => {
  it('starts with STOPPED/IDLE and no optional fields', () => {
    const ds = new DiagnosticsSource()
    const s = ds.getSummary()
    expect(s.lifecycle).toBe('STOPPED')
    expect(s.activity).toBe('IDLE')
    expect(s.lastCommentReceivedAt).toBeUndefined()
    expect(s.lastSuggestionAt).toBeUndefined()
    expect(s.lastDomainError).toBeUndefined()
  })

  it('recordCommentReceived sets lastCommentReceivedAt', () => {
    const ds = new DiagnosticsSource()
    ds.recordCommentReceived()
    expect(ds.getSummary().lastCommentReceivedAt).toBeDefined()
  })

  it('recordSuggestion sets result and latency', () => {
    const ds = new DiagnosticsSource()
    ds.recordSuggestion('displayed', 1200)
    const s = ds.getSummary()
    expect(s.lastSuggestionResult).toBe('displayed')
    expect(s.lastE2eLatencyMs).toBe(1200)
  })

  it('getSummary does not expose raw message content', () => {
    const ds = new DiagnosticsSource()
    const json = JSON.stringify(ds.getSummary())
    expect(json).not.toContain('弹幕')
    expect(json).not.toContain('昵称')
    expect(json).not.toContain('api_key')
  })
})

describe('Logger', () => {
  it('log entry does not contain sensitive field names', () => {
    const logger = new Logger()
    const captured: string[] = []
    const orig = console.log
    console.log = (s: string) => captured.push(s)
    logger.info('general', 'service started')
    console.log = orig
    expect(captured.length).toBeGreaterThan(0)
    const output = captured.join('\n')
    expect(output).not.toContain('trace_id')
    expect(output).not.toContain('api_key')
    expect(output).not.toContain('弹幕')
  })
})
