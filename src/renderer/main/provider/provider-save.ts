import type { ConfigUpdateRequestV1, ConfigViewV1 } from '@echocue/contracts'
import { buildConfigUpdate, type ProviderForm } from './provider-form'

export interface ProviderSaveApi {
  configUpdate: (input: ConfigUpdateRequestV1) => Promise<ConfigViewV1>
  setApiKey: (providerId: string, apiKey: string) => Promise<{ apiKeyConfigured: boolean }>
}

// Two-step save: config.update first (so the derived credentialRef exists), then
// the freshly-typed key under that providerId. Returns the view with the key
// state merged from the setApiKey result — the update view alone would be stale
// (it reflects the key before it was stored).
export async function saveProviderConfig(
  api: ProviderSaveApi,
  input: { roomReference: string; form: ProviderForm },
): Promise<ConfigViewV1> {
  const updated = await api.configUpdate(buildConfigUpdate(input))
  const apiKey = input.form.apiKey.trim()
  if (apiKey.length > 0 && updated.provider) {
    const cred = await api.setApiKey(updated.provider.providerId, apiKey)
    return { ...updated, apiKeyConfigured: cred.apiKeyConfigured }
  }
  return updated
}
