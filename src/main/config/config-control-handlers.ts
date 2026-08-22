import { ConfigUpdateRequestV1Schema, OverlayPreferenceV1Schema, type ConfigViewV1, type OverlayPreferenceV1, type ProviderConfigV1, type SettingsV1 } from '@echocue/contracts';
import type { ProviderConfigService } from '../provider/provider-config.js';
import { CredentialStore } from '../credentials/index.js';
import { ConfigCorruptError, SettingsStore } from './SettingsStore.js';

export interface ConfigControlDeps {
  settings: SettingsStore;
  providerConfig: ProviderConfigService;
  /** Live-apply window (M6-07): re-applies feasible visual prefs on update. */
  overlayWindow?: { applyPreferences(prefs: OverlayPreferenceV1): Promise<void> };
}

export interface ConfigControlHandlers {
  get: () => Promise<ConfigViewV1>;
  update: (raw: unknown) => Promise<ConfigViewV1>;
  updateOverlay: (raw: unknown) => Promise<OverlayPreferenceV1>;
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
      try {
        if (provider !== undefined) {
          const currentProvider = await deps.providerConfig.getProviderConfig();
          const providerId = slugifyProviderId(provider.displayName);
          // Keep the stored credentialRef when the provider identity is unchanged;
          // a host/adapter change invalidates the old key inside updateProviderConfig.
          const credentialRef =
            currentProvider?.providerId === providerId
              ? currentProvider.credentialRef
              : CredentialStore.buildCredentialRef(providerId);
          const next: ProviderConfigV1 = {
            providerId,
            displayName: provider.displayName,
            adapterType: provider.adapterType,
            baseUrl: provider.baseUrl,
            modelId: provider.modelId,
            credentialRef,
          };
          await deps.providerConfig.updateProviderConfig(next);
        }
        if (roomReference !== undefined) {
          await deps.settings.update({ roomReference });
        }
      } catch (err) {
        if (err instanceof ConfigCorruptError) {
          throw new Error('配置读取失败，请检查设置文件或恢复默认设置');
        }
        throw err;
      }
      return this.get();
    },

    async updateOverlay(raw) {
      const parsed = OverlayPreferenceV1Schema.safeParse(raw);
      if (!parsed.success) {
        throw new Error('浮窗偏好不合法');
      }
      const overlay = parsed.data;
      try {
        await deps.settings.update({ overlay });
      } catch (err) {
        if (err instanceof ConfigCorruptError) {
          throw new Error('配置读取失败，请检查设置文件或恢复默认设置');
        }
        throw err;
      }
      // Live-apply is best-effort: persistence already succeeded, and the next
      // show re-applies the prefs anyway. A destroyed window must not fail save.
      try {
        await deps.overlayWindow?.applyPreferences(overlay);
      } catch {
        /* ignored */
      }
      return overlay;
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

// Derive a stable providerId from the display name (CredentialStore providerId
// rule ^[a-z0-9_-]{1,64}$); a non-ASCII/empty slug falls back to 'default'.
function slugifyProviderId(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug.length > 0 ? slug : 'default';
}
