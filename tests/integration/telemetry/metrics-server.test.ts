import { describe, it, expect, afterEach } from 'vitest'
import { get } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EchocueMetrics } from '../../../src/main/telemetry/Metrics.js'
import { createMetricsServer, type MetricsServerHandle } from '../../../src/main/telemetry/metrics-server.js'

function fetchText(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') })
      })
    }).on('error', reject)
  })
}

// Poll until the server is listening on an OS-assigned port (start() is async).
async function waitForAddress(server: MetricsServerHandle): Promise<AddressInfo> {
  for (let i = 0; i < 100; i += 1) {
    const addr = server.getBoundAddress()
    if (addr !== null) return addr
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('metrics server did not bind within timeout')
}

describe('metrics loopback server (WP-1 / TD-03)', () => {
  const handles: MetricsServerHandle[] = []

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((h) => h.stop()))
  })

  it('binds 127.0.0.1 and serves prometheus text on /metrics', async () => {
    const metrics = new EchocueMetrics()
    metrics.commentReceived.inc()
    const server = createMetricsServer({ metrics, port: 0 })
    handles.push(server)
    server.start()

    const addr = await waitForAddress(server)
    expect(addr.address).toBe('127.0.0.1')
    const { status, body } = await fetchText(`http://127.0.0.1:${addr.port}/metrics`)
    expect(status).toBe(200)
    expect(body).toContain('echocue_comment_received_total')
    expect(body).not.toContain('trace_id')
  })

  it('reports health and 404s unknown routes', async () => {
    const metrics = new EchocueMetrics()
    const server = createMetricsServer({ metrics, port: 0 })
    handles.push(server)
    server.start()
    const addr = await waitForAddress(server)

    const health = await fetchText(`http://127.0.0.1:${addr.port}/health`)
    expect(health.status).toBe(200)
    expect(JSON.parse(health.body)).toEqual({ ok: true })

    const notFound = await fetchText(`http://127.0.0.1:${addr.port}/nope`)
    expect(notFound.status).toBe(404)
  })
})
