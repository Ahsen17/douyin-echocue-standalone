import { z } from 'zod';
import { CredentialStore } from '../credentials/index.js';
import type { ProviderConfigService } from './provider-config.js';

// Matches CredentialStore's providerId rule so invalid ids fail fast at the IPC boundary.
const PROVIDER_ID_RE = /^[a-z0-9_-]{1,64}$/;

const CredentialSetRequestSchema = z.strictObject({
  providerId: z.string().regex(PROVIDER_ID_RE),
  apiKey: z.string().min(1).max(4096),
});

const CredentialClearRequestSchema = z.strictObject({
  providerId: z.string().regex(PROVIDER_ID_RE),
});

export interface ProviderCredentialHandlers {
  set: (raw: unknown) => Promise<{ apiKeyConfigured: true }>;
  clear: (raw: unknown) => Promise<{ apiKeyConfigured: false }>;
  test: () => Promise<import('@echocue/contracts').ConnectionTestResultV1>;
}

/** Core credential IPC logic, decoupled from electron so it is unit-testable. */
export function createProviderCredentialHandlers(
  configService: ProviderConfigService,
): ProviderCredentialHandlers {
  return {
    async set(raw) {
      const req = CredentialSetRequestSchema.parse(raw);
      await assertProviderIdMatchesConfig(configService, req.providerId);
      await configService.setApiKey(req.providerId, req.apiKey);
      return { apiKeyConfigured: true };
    },
    async clear(raw) {
      const req = CredentialClearRequestSchema.parse(raw);
      await assertProviderIdMatchesConfig(configService, req.providerId);
      await configService.clearApiKey(req.providerId);
      return { apiKeyConfigured: false };
    },
    async test() {
      return configService.testConnection();
    },
  };
}

/**
 * The credential must be stored under the providerId implied by the configured
 * credentialRef; otherwise a stored key would never be found by testConnection
 * and the UI would be stuck in a permanent AUTH_FAILED state.
 */
async function assertProviderIdMatchesConfig(
  configService: ProviderConfigService,
  providerId: string,
): Promise<void> {
  const provider = await configService.getProviderConfig();
  if (!provider) {
    throw new Error('no provider configured');
  }
  const expected = CredentialStore.parseCredentialRef(provider.credentialRef);
  if (!expected || expected !== providerId) {
    throw new Error('providerId does not match configured credentialRef');
  }
}
