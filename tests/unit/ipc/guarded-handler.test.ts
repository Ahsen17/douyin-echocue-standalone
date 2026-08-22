import { describe, it, expect } from 'vitest'
import { createGuardedHandler } from '../../../src/main/ipc/guarded-handler.js'

const TRUSTED = { sender: { id: 1 } }
const UNTRUSTED = { sender: { id: 99 } }

describe('createGuardedHandler', () => {
  const isTrusted = (sender: unknown) => (sender as { id: number }).id === 1

  it('invokes the handler for a trusted sender', () => {
    const handler = createGuardedHandler(isTrusted, (raw) => ({ echo: raw }))
    expect(handler(TRUSTED, 'payload')).toEqual({ echo: 'payload' })
  })

  it('rejects an untrusted sender before reaching the handler', () => {
    const calls: unknown[] = []
    const handler = createGuardedHandler(isTrusted, (raw) => {
      calls.push(raw)
      return 'ok'
    })
    expect(() => handler(UNTRUSTED, 'payload')).toThrow(/untrusted sender/)
    expect(calls).toEqual([])
  })

  it('passes the raw payload through unchanged', async () => {
    const handler = createGuardedHandler(isTrusted, async (raw) => ({ raw }))
    const result = await handler(TRUSTED, { a: 1 })
    expect(result).toEqual({ raw: { a: 1 } })
  })

  it('supports handlers with no payload (raw undefined)', () => {
    const handler = createGuardedHandler(isTrusted, () => 'done')
    expect(handler(TRUSTED, undefined)).toBe('done')
  })
})
