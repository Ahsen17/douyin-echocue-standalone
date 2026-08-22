import { describe, it, expect } from 'vitest'
import type { ConfigViewV1 } from '@echocue/contracts'
import { saveProviderConfig } from '../../../src/renderer/main/provider/provider-save.js'
import type { ProviderForm } from '../../../src/renderer/main/provider/provider-form.js'

function view(partial: Partial<ConfigViewV1> = {}): ConfigViewV1 {
  return {
    overlay: {
      durationMs: 5000,
      width: 800,
      height: 200,
      opacity: 0.9,
      fontScale: 1,
      theme: 'dark',
      clickThrough: false,
    },
    apiKeyConfigured: false,
    ...partial,
  }
}

function form(overrides: Partial<ProviderForm> = {}): ProviderForm {
  return {
    displayName: 'DeepSeek',
    adapterType: 'DEEPSEEK',
    baseUrl: 'https://api.deepseek.com',
    modelId: 'deepseek-chat',
    apiKey: '',
    ...overrides,
  }
}

describe('saveProviderConfig (UI §7.1 two-step save)', () => {
  it('first-time key save merges apiKeyConfigured true into the returned view', async () => {
    const updatedBefore = view({ provider: { providerId: 'deepseek-primary' } as never })
    const api = {
      configUpdate: async () => updatedBefore,
      setApiKey: async () => ({ apiKeyConfigured: true }),
    }
    const result = await saveProviderConfig(api, {
      roomReference: 'room-1',
      form: form({ apiKey: 'sk-new' }),
    })
    expect(result.apiKeyConfigured).toBe(true)
  })

  it('does not call setApiKey and keeps apiKeyConfigured when no key is typed', async () => {
    const updatedBefore = view({ apiKeyConfigured: true, provider: { providerId: 'p' } as never })
    let setCalls = 0
    const api = {
      configUpdate: async () => updatedBefore,
      setApiKey: async () => {
        setCalls += 1
        return { apiKeyConfigured: true }
      },
    }
    const result = await saveProviderConfig(api, { roomReference: '', form: form({ apiKey: '' }) })
    expect(setCalls).toBe(0)
    expect(result.apiKeyConfigured).toBe(true)
  })

  it('trims a whitespace-only apiKey before deciding to store it', async () => {
    const updatedBefore = view({ apiKeyConfigured: false, provider: { providerId: 'p' } as never })
    let setCalls = 0
    const api = {
      configUpdate: async () => updatedBefore,
      setApiKey: async () => {
        setCalls += 1
        return { apiKeyConfigured: true }
      },
    }
    const result = await saveProviderConfig(api, {
      roomReference: 'room-1',
      form: form({ apiKey: '   ' }),
    })
    expect(setCalls).toBe(0)
    expect(result.apiKeyConfigured).toBe(false)
  })

  it('passes the trimmed key to setApiKey under the updated providerId', async () => {
    const updatedBefore = view({ provider: { providerId: 'deepseek-primary' } as never })
    let storedKey = ''
    const api = {
      configUpdate: async () => updatedBefore,
      setApiKey: async (providerId: string, apiKey: string) => {
        expect(providerId).toBe('deepseek-primary')
        storedKey = apiKey
        return { apiKeyConfigured: true }
      },
    }
    await saveProviderConfig(api, {
      roomReference: 'room-1',
      form: form({ apiKey: '  sk-new  ' }),
    })
    expect(storedKey).toBe('sk-new')
  })
})
