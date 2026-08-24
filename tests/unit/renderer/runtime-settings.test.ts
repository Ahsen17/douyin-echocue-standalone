import { describe, it, expect } from 'vitest'
import {
  DEFAULT_METRICS_PORT,
  DEFAULT_QUEUE_TIMEOUT_SEC,
  DEFAULT_RETENTION_DAYS,
  runtimeFormFromConfig,
  validateRuntimeForm,
} from '../../../src/renderer/main/system/runtime-settings.js'

describe('system-settings runtime form (WP-2.3 / WP-3.3)', () => {
  const baseForm = runtimeFormFromConfig({
    queueing: { enabled: false, timeoutMs: 30000 },
    audit: { retentionDays: 30 },
    metrics: { enabled: true, port: 9100 },
  } as never)

  it('seeds the form from the config view (ms → seconds)', () => {
    expect(baseForm).toEqual({
      queueingEnabled: false,
      queueTimeoutSec: '30',
      retentionDays: '30',
      metricsPort: '9100',
    })
  })

  it('builds a combined config update on valid input', () => {
    const result = validateRuntimeForm({
      queueingEnabled: true,
      queueTimeoutSec: '45',
      retentionDays: '14',
      metricsPort: '9200',
    })
    expect(result).toEqual({
      ok: true,
      update: {
        queueing: { enabled: true, timeoutMs: 45000 },
        auditRetentionDays: 14,
        metricsPort: 9200,
      },
    })
  })

  it('rejects out-of-range queue timeout, retention, and port', () => {
    expect(
      validateRuntimeForm({ ...baseForm, queueTimeoutSec: '0' }),
    ).toMatchObject({ ok: false, message: expect.stringContaining('排队超时') })
    expect(
      validateRuntimeForm({ ...baseForm, queueTimeoutSec: '121' }),
    ).toMatchObject({ ok: false })
    expect(
      validateRuntimeForm({ ...baseForm, retentionDays: '6' }),
    ).toMatchObject({ ok: false, message: expect.stringContaining('审计保留天数') })
    expect(
      validateRuntimeForm({ ...baseForm, retentionDays: '181' }),
    ).toMatchObject({ ok: false })
    expect(
      validateRuntimeForm({ ...baseForm, metricsPort: '1023' }),
    ).toMatchObject({ ok: false, message: expect.stringContaining('metrics 端口') })
    expect(
      validateRuntimeForm({ ...baseForm, metricsPort: '70000' }),
    ).toMatchObject({ ok: false })
  })

  it('rejects non-integer input', () => {
    expect(validateRuntimeForm({ ...baseForm, queueTimeoutSec: '30.5' })).toMatchObject({ ok: false })
    expect(validateRuntimeForm({ ...baseForm, retentionDays: 'abc' })).toMatchObject({ ok: false })
    expect(validateRuntimeForm({ ...baseForm, metricsPort: '' })).toMatchObject({ ok: false })
  })

  it('keeps documented defaults aligned', () => {
    expect(DEFAULT_QUEUE_TIMEOUT_SEC).toBe(30)
    expect(DEFAULT_RETENTION_DAYS).toBe(30)
    expect(DEFAULT_METRICS_PORT).toBe(9100)
  })
})
