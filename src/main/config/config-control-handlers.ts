import { ConfigUpdateRequestV1Schema, type ConfigViewV1, type SettingsV1 } from '@echocue/contracts';
import type { ProviderConfigService } from '../provider/provider-config.js';
import { CredentialStore } from '../credentials/index.js';
import { ConfigCorruptError, SettingsStore } from './SettingsStore.js';

export interface ConfigControlDeps {
  settings: SettingsStore;
  providerConfig: ProviderConfigService;
}

export interface ConfigControlHandlers {
  get: () => Promise<ConfigViewV1>;
  update: (raw: unknown) => Promise<ConfigViewV1>;
}

// Core config IPC logic, decoupled from electron for unit-testing. The response
// is the renderer view: internalRetrieval never crosses IPC and the API key
// surfaces only as apiKeyConfigured.
export function createConfigControlHandlers(deps: ConfigControlDeps): ConfigControlHandlers {
  return {
    async get() {
      const settings = await readSettings(deps.settings);
      const provider = await deps.providerConfig.getProviderConfig();
      const apiKeyConfigured = await isApiKeyConfigured(deps.providerConfig, provider);
      return {
        roomReference: settings.roomReference,
        provider: provider ?? undefined,
        activeSafetyPolicyVersion: settings.activeSafetyPolicyVersion,
        overlay: settings.overlay,
        apiKeyConfigured,
      };
    },

    async update(raw) {
      const parsed = ConfigUpdateRequestV1Schema.safeParse(raw);
      if (!parsed.success) {
        throw new Error('配置内容不合法，请检查输入后再保存');
      }
      const { roomReference, provider } = parsed.data;
      if (provider !== undefined) {
        // Provider config write (providerId derivation + credentialRef) lands in M6-03.
        throw new Error('提供商配置暂不可保存，请稍后再试');
      }
      if (roomReference !== undefined) {
        await deps.settings.update({ roomReference });
      }
      return this.get();
    },
  };
}

async function readSettings(settings: SettingsStore): Promise<SettingsV1> {
  try {
    const current = await settings.get();
    return current ?? settings.getDefaults();
  } catch (err) {
    if (err instanceof ConfigCorruptError) {
      throw new Error('配置读取失败，请检查设置文件或恢复默认设置');
    }
    throw err;
  }
}

async function isApiKeyConfigured(
  providerConfig: ProviderConfigService,
  provider: Awaited<ReturnType<ProviderConfigService['getProviderConfig']>>,
): Promise<boolean> {
  if (!provider) return false;
  const providerId = CredentialStore.parseCredentialRef(provider.credentialRef);
  if (!providerId) return false;
  return providerConfig.hasApiKey(providerId);
}
