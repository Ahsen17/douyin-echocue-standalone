import type { ConfigUpdateRequestV1, ConfigViewV1 } from '@echocue/contracts'

// Only adapters with a real implementation are offerable (M5-04); ANTHROPIC_MESSAGES
// has none and is never sent from the form.
export type OfferableAdapterType = 'DEEPSEEK' | 'OPENAI_COMPATIBLE'

export const OFFERABLE_ADAPTERS: OfferableAdapterType[] = ['DEEPSEEK', 'OPENAI_COMPATIBLE']

export interface ProviderForm {
  displayName: string
  adapterType: OfferableAdapterType
  baseUrl: string
  modelId: string
  /** Newly-typed key only; the stored key is never echoed into the form. */
  apiKey: string
}

export function initialForm(view: ConfigViewV1): ProviderForm {
  const provider = view.provider
  const adapterType: OfferableAdapterType =
    provider && (provider.adapterType === 'DEEPSEEK' || provider.adapterType === 'OPENAI_COMPATIBLE')
      ? provider.adapterType
      : 'OPENAI_COMPATIBLE'
  return {
    displayName: provider?.displayName ?? '',
    adapterType,
    baseUrl: provider?.baseUrl ?? '',
    modelId: provider?.modelId ?? '',
    apiKey: '',
  }
}

export function buildConfigUpdate(input: {
  roomReference?: string
  form: ProviderForm
}): ConfigUpdateRequestV1 {
  const { roomReference, form } = input
  const trimmedRoom = (roomReference ?? '').trim()
  const displayName = form.displayName.trim()
  const baseUrl = form.baseUrl.trim()
  return {
    ...(trimmedRoom.length > 0 ? { roomReference: trimmedRoom } : {}),
    provider: {
      // WP-11: empty displayName/baseUrl are omitted so the handler fills the
      // adapter defaults (DeepSeek gets its built-in base URL).
      ...(displayName.length > 0 ? { displayName } : {}),
      adapterType: form.adapterType,
      ...(baseUrl.length > 0 ? { baseUrl } : {}),
      modelId: form.modelId.trim(),
    },
  }
}

export type ProviderFormValidation = { ok: true } | { ok: false; message: string }

export function validateProviderForm(form: ProviderForm): ProviderFormValidation {
  const baseUrl = form.baseUrl.trim()
  if (form.adapterType === 'OPENAI_COMPATIBLE' && !baseUrl) {
    return { ok: false, message: 'OpenAI 兼容服务需填写 Base URL' }
  }
  if (baseUrl) {
    let url: URL
    try {
      url = new URL(baseUrl)
    } catch {
      return { ok: false, message: 'Base URL 格式不正确' }
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return { ok: false, message: 'Base URL 必须为无 userinfo/query/fragment 的 HTTPS 地址' }
    }
  }
  if (!form.modelId.trim()) return { ok: false, message: '请填写 Model ID' }
  return { ok: true }
}
