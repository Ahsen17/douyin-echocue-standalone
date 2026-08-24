import { ConfigUpdateRequestV1Schema, OverlayPreferenceV1Schema, type ConfigViewV1, type OverlayPreferenceV1, type ProviderConfigV1, type SettingsV1, type SystemPromptV1 } from '@echocue/contracts';
import { DEEPSEEK_DEFAULT_BASE_URL, type ProviderConfigService } from '../provider/index.js';
import { CredentialStore } from '../credentials/index.js';
import { uuidv7 } from '../util/index.js';
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
        prompt: settings.prompt,
        directPushThreshold: settings.internalRetrieval.directPushThreshold,
        semanticDiscardConfidence:
          settings.internalRetrieval.semanticDiscardConfidence ?? 0.9,
        queueing: settings.queueing ?? { enabled: false, timeoutMs: 30000 },
        audit: settings.audit ?? { retentionDays: 30 },
        metrics: settings.metrics ?? { enabled: true, port: 9100 },
        riskFilter: settings.riskFilter ?? { types: [] },
        apiKeyConfigured,
      };
    },

    async update(raw) {
      const parsed = ConfigUpdateRequestV1Schema.safeParse(raw);
      if (!parsed.success) {
        throw new Error('配置内容不合法，请检查输入后再保存');
      }
      const {
        roomReference,
        provider,
        systemPrompt,
        directPushThreshold,
        semanticDiscardConfidence,
        queueing,
        auditRetentionDays,
        metricsPort,
        riskFilter,
      } = parsed.data;
      try {
        if (provider !== undefined) {
          const currentProvider = await deps.providerConfig.getProviderConfig();
          // WP-11: empty displayName/baseUrl get adapter defaults; an OpenAI
          // compatible config without a base URL is rejected.
          const displayName = (provider.displayName ?? '').trim() || defaultProviderName(provider.adapterType);
          const baseUrl =
            (provider.baseUrl ?? '').trim() ||
            (provider.adapterType === 'DEEPSEEK' ? DEEPSEEK_DEFAULT_BASE_URL : '');
          if (baseUrl === '') {
            throw new Error('OpenAI 兼容服务需填写 Base URL');
          }
          const providerId = slugifyProviderId(displayName);
          // Keep the stored credentialRef when the provider identity is unchanged;
          // a host/adapter change invalidates the old key inside updateProviderConfig.
          const credentialRef =
            currentProvider?.providerId === providerId
              ? currentProvider.credentialRef
              : CredentialStore.buildCredentialRef(providerId);
          const next: ProviderConfigV1 = {
            providerId,
            displayName,
            adapterType: provider.adapterType,
            baseUrl,
            modelId: provider.modelId,
            credentialRef,
          };
          await deps.providerConfig.updateProviderConfig(next);
        }
        if (roomReference !== undefined) {
          await deps.settings.update({ roomReference });
        }
        if (systemPrompt !== undefined) {
          // TD-08: empty submission clears the custom template back to the code
          // default; otherwise stamp a fresh template version for audit replay.
          const trimmed = systemPrompt.trim();
          const prompt: SystemPromptV1 | undefined =
            trimmed === ''
              ? undefined
              : {
                  systemPromptTemplate: trimmed,
                  templateVersion: `custom-${uuidv7()}`,
                  updatedAt: new Date().toISOString(),
                };
          await deps.settings.update({ prompt });
        }
        // Retrieval thresholds: merge into internalRetrieval so the other
        // internal fields survive the partial write. Applied on next service
        // start (the orchestrator freezes them per session).
        if (directPushThreshold !== undefined || semanticDiscardConfidence !== undefined) {
          const currentSettings = await readSettings(deps.settings);
          await deps.settings.update({
            internalRetrieval: {
              ...currentSettings.internalRetrieval,
              ...(directPushThreshold !== undefined ? { directPushThreshold } : {}),
              ...(semanticDiscardConfidence !== undefined ? { semanticDiscardConfidence } : {}),
            },
          });
        }
        if (queueing !== undefined) {
          await deps.settings.update({ queueing });
        }
        if (auditRetentionDays !== undefined) {
          await deps.settings.update({ audit: { retentionDays: auditRetentionDays } });
        }
        if (metricsPort !== undefined) {
          const currentMetrics = (await readSettings(deps.settings)).metrics;
          await deps.settings.update({
            metrics: { ...(currentMetrics ?? { enabled: true, port: 9100 }), port: metricsPort },
          });
        }
        if (riskFilter !== undefined) {
          await deps.settings.update({ riskFilter });
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

// WP-11: default display name when the form field is left empty; the derived
// providerId (deepseek / openai-compatible) stays stable across saves.
function defaultProviderName(adapterType: ProviderConfigV1['adapterType']): string {
  return adapterType === 'DEEPSEEK' ? 'DeepSeek' : 'OpenAI Compatible';
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
