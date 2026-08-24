import { DEEPSEEK_DEFAULT_BASE_URL, ProviderConfigV1Schema, type ProviderConfigV1 } from '@echocue/contracts';

export { DEEPSEEK_DEFAULT_BASE_URL };
import { SettingsStore } from '../config/index.js';
import { CredentialStore } from '../credentials/index.js';
import { fetchJson } from './http.js';
import type { ChatCompletionsProbe, ConnectionTestResult } from './types.js';

const CONNECTION_TEST_TIMEOUT_MS = 5000;
const PROBE_PATH = '/chat/completions';

/** Minimal chat/completions probe used by the connection test; never logs request or response. */
const defaultProbe: ChatCompletionsProbe = async (input) => {
  const response = await fetchJson({
    baseUrl: input.baseUrl,
    path: PROBE_PATH,
    method: 'POST',
    body: input.body,
    apiKey: input.apiKey,
    timeoutMs: input.timeoutMs,
  });
  return { status: response.status };
};

export class ProviderConfigService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly credentials: CredentialStore,
    private readonly probe: ChatCompletionsProbe = defaultProbe,
  ) {}

  async getProviderConfig(): Promise<ProviderConfigV1 | null> {
    const settings = await this.settings.get();
    return settings?.provider ?? null;
  }

  /** Validate and persist provider config; invalidate the stored key when host/adapter changes. */
  async updateProviderConfig(config: ProviderConfigV1): Promise<void> {
    const validated = ProviderConfigV1Schema.parse(config);
    const current = await this.settings.get();
    const oldProvider = current?.provider;
    // Persist the new host/adapter first; a leftover key from a failed invalidation
    // fails closed (AUTH_FAILED against the new host) and is cleared on retry.
    await this.settings.update({ provider: validated });
    await this.credentials.invalidateIfProviderChanged(oldProvider, validated);
  }

  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.credentials.setCredential(providerId, apiKey);
  }

  async clearApiKey(providerId: string): Promise<void> {
    await this.credentials.deleteCredential(providerId);
  }

  /** Reads from disk so a key persisted on a previous launch is reported as configured. */
  async hasApiKey(providerId: string): Promise<boolean> {
    const key = await this.credentials.getCredential(providerId);
    return key !== null;
  }

  /**
   * UI §7.1 three-state connection test. The probe request/response are never
   * logged or returned; only the status (OK / AUTH_FAILED / UNAVAILABLE) leaks out.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const provider = await this.getProviderConfig();
      if (!provider) return { status: 'UNAVAILABLE' };

      const providerId = CredentialStore.parseCredentialRef(provider.credentialRef);
      if (!providerId) return { status: 'AUTH_FAILED' };

      const apiKey = await this.credentials.getCredential(providerId);
      if (!apiKey) return { status: 'AUTH_FAILED' };

      try {
        const result = await this.probe({
          baseUrl: provider.baseUrl,
          path: PROBE_PATH,
          body: {
            model: provider.modelId,
            messages: [{ role: 'user', content: 'ping' }],
            stream: false,
            max_tokens: 1,
          },
          apiKey,
          timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
        });
        if (result.status === 200) return { status: 'OK' };
        // 401/403 both mean the credential is rejected.
        if (result.status === 401 || result.status === 403) return { status: 'AUTH_FAILED' };
        return { status: 'UNAVAILABLE' };
      } catch {
        // network / timeout / 5xx all collapse to UNAVAILABLE; never propagate internals
        return { status: 'UNAVAILABLE' };
      }
    } catch {
      // corrupt settings / storage read errors also collapse to UNAVAILABLE, no internals leak
      return { status: 'UNAVAILABLE' };
    }
  }
}
