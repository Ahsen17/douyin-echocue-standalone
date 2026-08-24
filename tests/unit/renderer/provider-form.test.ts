import { describe, it, expect } from 'vitest'
import type { ConfigViewV1 } from '@echocue/contracts'
import {
  buildConfigUpdate,
  initialForm,
  validateProviderForm,
} from '../../../src/renderer/main/provider/provider-form.js'

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

describe('provider form (UI §7.1)', () => {
  it('initialForm returns empty fields with apiKey always empty', () => {
    const form = initialForm(view())
    expect(form.apiKey).toBe('')
    expect(form.displayName).toBe('')
    expect(form.baseUrl).toBe('')
    expect(form.adapterType).toBe('OPENAI_COMPATIBLE')
  })

  it('initialForm never echoes the stored key even when configured', () => {
    const form = initialForm(
      view({
        apiKeyConfigured: true,
        provider: {
          providerId: 'deepseek-primary',
          displayName: 'DeepSeek',
          adapterType: 'DEEPSEEK',
          baseUrl: 'https://api.deepseek.com',
          modelId: 'deepseek-chat',
          credentialRef: 'safe-storage:deepseek-primary',
        },
      }),
    )
    expect(form.apiKey).toBe('')
    expect(form.displayName).toBe('DeepSeek')
    expect(form.adapterType).toBe('DEEPSEEK')
  })

  it('initialForm falls back to OPENAI_COMPATIBLE for ANTHROPIC_MESSAGES (no adapter)', () => {
    const form = initialForm(
      view({
        provider: {
          providerId: 'anthropic',
          displayName: 'Anthropic',
          adapterType: 'ANTHROPIC_MESSAGES',
          baseUrl: 'https://api.anthropic.com',
          modelId: 'claude',
          credentialRef: 'safe-storage:anthropic',
        },
      }),
    )
    expect(form.adapterType).toBe('OPENAI_COMPATIBLE')
  })

  it('buildConfigUpdate trims and includes roomReference and provider fields', () => {
    const request = buildConfigUpdate({
      roomReference: '  room-1  ',
      form: {
        displayName: '  DeepSeek  ',
        adapterType: 'DEEPSEEK',
        baseUrl: '  https://api.deepseek.com  ',
        modelId: ' deepseek-chat ',
        apiKey: '',
      },
    })
    expect(request.roomReference).toBe('room-1')
    expect(request.provider).toEqual({
      displayName: 'DeepSeek',
      adapterType: 'DEEPSEEK',
      baseUrl: 'https://api.deepseek.com',
      modelId: 'deepseek-chat',
    })
  })

  it('buildConfigUpdate omits roomReference when empty', () => {
    const request = buildConfigUpdate({
      roomReference: '   ',
      form: {
        displayName: 'DeepSeek',
        adapterType: 'DEEPSEEK',
        baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-chat',
        apiKey: '',
      },
    })
    expect(request.roomReference).toBeUndefined()
    expect(request.provider).toBeDefined()
  })

  it('buildConfigUpdate works without a roomReference (decoupled AI-service save)', () => {
    const request = buildConfigUpdate({
      form: {
        displayName: 'DeepSeek',
        adapterType: 'DEEPSEEK',
        baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-chat',
        apiKey: '',
      },
    })
    expect(request.roomReference).toBeUndefined()
    expect(request.provider).toBeDefined()
  })

  it('validateProviderForm accepts a valid form', () => {
    const result = validateProviderForm({
      displayName: 'DeepSeek',
      adapterType: 'DEEPSEEK',
      baseUrl: 'https://api.deepseek.com',
      modelId: 'deepseek-chat',
      apiKey: '',
    })
    expect(result).toEqual({ ok: true })
  })

  it('validateProviderForm accepts a DeepSeek form without displayName/baseUrl (WP-11)', () => {
    const result = validateProviderForm({
      displayName: '',
      adapterType: 'DEEPSEEK',
      baseUrl: '',
      modelId: 'deepseek-chat',
      apiKey: '',
    })
    expect(result).toEqual({ ok: true })
  })

  it('validateProviderForm requires a Base URL for OpenAI compatible (WP-11)', () => {
    const result = validateProviderForm({
      displayName: 'OpenAI',
      adapterType: 'OPENAI_COMPATIBLE',
      baseUrl: '',
      modelId: 'gpt-4o-mini',
      apiKey: '',
    })
    expect(result).toEqual({ ok: false, message: 'OpenAI 兼容服务需填写 Base URL' })
  })

  it('buildConfigUpdate omits empty displayName and baseUrl for adapter defaults (WP-11)', () => {
    const request = buildConfigUpdate({
      form: {
        displayName: '',
        adapterType: 'DEEPSEEK',
        baseUrl: '',
        modelId: 'deepseek-chat',
        apiKey: '',
      },
    })
    expect(request.provider).toEqual({
      adapterType: 'DEEPSEEK',
      modelId: 'deepseek-chat',
    })
  })

  it('validateProviderForm rejects http and userinfo/query/hash baseUrl', () => {
    const base = {
      displayName: 'X',
      adapterType: 'DEEPSEEK' as const,
      modelId: 'm',
      apiKey: '',
    }
    expect(validateProviderForm({ ...base, baseUrl: 'http://api.x.com' }).ok).toBe(false)
    expect(validateProviderForm({ ...base, baseUrl: 'https://u:p@api.x.com' }).ok).toBe(false)
    expect(validateProviderForm({ ...base, baseUrl: 'https://api.x.com?x=1' }).ok).toBe(false)
    expect(validateProviderForm({ ...base, baseUrl: 'https://api.x.com#f' }).ok).toBe(false)
    expect(validateProviderForm({ ...base, baseUrl: 'not a url' }).ok).toBe(false)
  })

  it('validateProviderForm rejects missing modelId', () => {
    const result = validateProviderForm({
      displayName: 'X',
      adapterType: 'DEEPSEEK',
      baseUrl: 'https://api.x.com',
      modelId: '',
      apiKey: '',
    })
    expect(result).toEqual({ ok: false, message: '请填写 Model ID' })
  })
})
