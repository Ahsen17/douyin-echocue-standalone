import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SettingsStore, createConfigControlHandlers } from '../../../src/main/config/index.js';
import { CredentialStore, type SafeStorageLike } from '../../../src/main/credentials/index.js';
import { ProviderConfigService } from '../../../src/main/provider/index.js';

function makeMockStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (b) => b.toString('utf-8').slice(4),
  };
}

const VALID_PROVIDER_CONFIG = {
  providerId: 'deepseek-primary',
  displayName: '首选服务',
  adapterType: 'DEEPSEEK' as const,
  baseUrl: 'https://api.deepseek.com',
  modelId: 'deepseek-chat',
  credentialRef: 'safe-storage:deepseek-primary',
};

describe('Config IPC handlers', () => {
  let testDir: string;
  let settings: SettingsStore;
  let providerConfig: ProviderConfigService;
  let handlers: ReturnType<typeof createConfigControlHandlers>;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-config-ipc-test-'));
    settings = new SettingsStore(testDir);
    providerConfig = new ProviderConfigService(
      settings,
      new CredentialStore(testDir, makeMockStorage()),
    );
    handlers = createConfigControlHandlers({ settings, providerConfig });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('get returns defaults with apiKeyConfigured false when unconfigured', async () => {
    const view = await handlers.get();
    expect(view.roomReference).toBeUndefined();
    expect(view.provider).toBeUndefined();
    expect(view.apiKeyConfigured).toBe(false);
    expect(view.overlay.durationMs).toBe(10000);
    expect('internalRetrieval' in view).toBe(false);
  });

  it('get returns the WP-0 view defaults (thresholds, queueing, audit, metrics, riskFilter)', async () => {
    const view = await handlers.get();
    expect(view.directPushThreshold).toBe(0.85);
    expect(view.semanticDiscardConfidence).toBe(0.9);
    expect(view.preSetCalibration).toEqual({ center: 0, scale: 2 });
    expect(view.goldenSetCalibration).toEqual({ center: 0, scale: 2 });
    expect(view.queueing).toEqual({ enabled: false, timeoutMs: 30000 });
    expect(view.audit).toEqual({ retentionDays: 30 });
    expect(view.metrics).toEqual({ enabled: true, port: 9100 });
    expect(view.riskFilter).toEqual({ types: [] });
  });

  it('update persists the two retrieval thresholds merged into internalRetrieval', async () => {
    const view = await handlers.update({ directPushThreshold: 0.9, semanticDiscardConfidence: 0.85 });
    expect(view.directPushThreshold).toBe(0.9);
    expect(view.semanticDiscardConfidence).toBe(0.85);
    const stored = await settings.get();
    expect(stored?.internalRetrieval.directPushThreshold).toBe(0.9);
    expect(stored?.internalRetrieval.semanticDiscardConfidence).toBe(0.85);
    expect(stored?.internalRetrieval.calibrationVersion).toBe('v1.0'); // untouched
  });

  it('update persists per-collection calibration params into internalRetrieval', async () => {
    const view = await handlers.update({
      preSetCalibration: { center: -1, scale: 3 },
      goldenSetCalibration: { center: 2, scale: 4 },
    });
    expect(view.preSetCalibration).toEqual({ center: -1, scale: 3 });
    expect(view.goldenSetCalibration).toEqual({ center: 2, scale: 4 });
    const stored = await settings.get();
    expect(stored?.internalRetrieval.preSetCalibration).toEqual({ center: -1, scale: 3 });
    expect(stored?.internalRetrieval.goldenSetCalibration).toEqual({ center: 2, scale: 4 });
    expect(stored?.internalRetrieval.directPushThreshold).toBe(0.85); // untouched
  });

  it('update persists queueing, audit retention, metrics port and risk filter', async () => {
    const view = await handlers.update({
      queueing: { enabled: true, timeoutMs: 30000 },
      auditRetentionDays: 60,
      metricsPort: 9200,
      riskFilter: {
        types: [
          { typeId: '01932a3b-4c5d-7000-8000-0000000000aa', label: '违禁词', keywords: ['赌博'] },
        ],
      },
    });
    expect(view.queueing).toEqual({ enabled: true, timeoutMs: 30000 });
    expect(view.audit).toEqual({ retentionDays: 60 });
    expect(view.metrics).toEqual({ enabled: true, port: 9200 });
    expect(view.riskFilter.types).toHaveLength(1);
  });

  it('get returns the history feed defaults', async () => {
    const view = await handlers.get();
    expect(view.history).toEqual({ maxEntries: 20 });
  });

  it('update persists historyMaxEntries and live-applies the capacity', async () => {
    const applyCapacity = vi.fn();
    const withHistory = createConfigControlHandlers({
      settings,
      providerConfig,
      history: { applyCapacity, applyVisualPrefs: vi.fn() },
    });
    const view = await withHistory.update({ historyMaxEntries: 50 });
    expect(view.history).toEqual({ maxEntries: 50 });
    const stored = await settings.get();
    expect(stored?.history).toEqual({ maxEntries: 50 });
    expect(applyCapacity).toHaveBeenCalledWith(50);
  });

  it('update rejects a historyMaxEntries out of range', async () => {
    await expect(handlers.update({ historyMaxEntries: 0 })).rejects.toThrow('配置内容不合法');
    await expect(handlers.update({ historyMaxEntries: 121 })).rejects.toThrow('配置内容不合法');
  });

  it('update rejects a metrics port out of range', async () => {
    await expect(handlers.update({ metricsPort: 80 })).rejects.toThrow('配置内容不合法');
  });

  it('get surfaces apiKeyConfigured true after a key is stored, never the key value', async () => {
    await providerConfig.updateProviderConfig(VALID_PROVIDER_CONFIG);
    await providerConfig.setApiKey('deepseek-primary', 'sk-top-secret');
    const view = await handlers.get();
    expect(view.apiKeyConfigured).toBe(true);
    expect(view.provider?.providerId).toBe('deepseek-primary');
    expect(JSON.stringify(view)).not.toContain('sk-top-secret');
  });

  it('update persists roomReference', async () => {
    const view = await handlers.update({ roomReference: 'room-123' });
    expect(view.roomReference).toBe('room-123');
  });

  it('update returns the refreshed view including apiKeyConfigured', async () => {
    await providerConfig.updateProviderConfig(VALID_PROVIDER_CONFIG);
    await providerConfig.setApiKey('deepseek-primary', 'sk-secret');
    const view = await handlers.update({ roomReference: 'room-456' });
    expect(view.roomReference).toBe('room-456');
    expect(view.apiKeyConfigured).toBe(true);
  });

  it('update persists a provider with a derived providerId and credentialRef', async () => {
    const view = await handlers.update({
      provider: {
        displayName: 'DeepSeek 首选',
        adapterType: 'DEEPSEEK',
        baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-chat',
      },
    });
    expect(view.provider?.displayName).toBe('DeepSeek 首选');
    expect(view.provider?.providerId).toBe('deepseek'); // ASCII parts survive the slug
    expect(view.provider?.credentialRef).toContain('safe-storage:');
  });

  it('update falls back to default providerId for a fully non-ASCII name', async () => {
    const view = await handlers.update({
      provider: {
        displayName: '首选模型服务',
        adapterType: 'DEEPSEEK',
        baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-chat',
      },
    });
    expect(view.provider?.providerId).toBe('default');
  });

  it('update fills default name and built-in base URL for an empty DeepSeek form (WP-11)', async () => {
    const view = await handlers.update({
      provider: {
        adapterType: 'DEEPSEEK',
        modelId: 'deepseek-chat',
      },
    });
    expect(view.provider?.displayName).toBe('DeepSeek');
    expect(view.provider?.providerId).toBe('deepseek');
    expect(view.provider?.baseUrl).toBe('https://api.deepseek.com');
  });

  it('update rejects an OpenAI compatible config without a base URL (WP-11)', async () => {
    await expect(
      handlers.update({
        provider: {
          adapterType: 'OPENAI_COMPATIBLE',
          modelId: 'gpt-4o-mini',
        },
      }),
    ).rejects.toThrow('OpenAI 兼容服务需填写 Base URL');
  });

  it('update keeps a user-supplied base URL when DeepSeek provides one (WP-11)', async () => {
    const view = await handlers.update({
      provider: {
        displayName: 'DeepSeek',
        adapterType: 'DEEPSEEK',
        baseUrl: 'https://api.deepseek.com/v2',
        modelId: 'deepseek-chat',
      },
    });
    expect(view.provider?.baseUrl).toBe('https://api.deepseek.com/v2');
  });

  it('update keeps the stored credentialRef when providerId is unchanged', async () => {
    await providerConfig.updateProviderConfig(VALID_PROVIDER_CONFIG);
    const view = await handlers.update({
      provider: {
        displayName: 'deepseek-primary', // slug → same providerId
        adapterType: 'DEEPSEEK',
        baseUrl: 'https://api.deepseek.com/v2',
        modelId: 'deepseek-chat-v2',
      },
    });
    expect(view.provider?.providerId).toBe('deepseek-primary');
    expect(view.provider?.credentialRef).toBe('safe-storage:deepseek-primary');
    expect(view.provider?.baseUrl).toBe('https://api.deepseek.com/v2');
  });

  it('update changes providerId and credentialRef when the slug differs', async () => {
    await providerConfig.updateProviderConfig(VALID_PROVIDER_CONFIG);
    const view = await handlers.update({
      provider: {
        displayName: 'openai-compatible',
        adapterType: 'OPENAI_COMPATIBLE',
        baseUrl: 'https://api.openai.com',
        modelId: 'gpt-4o-mini',
      },
    });
    expect(view.provider?.providerId).toBe('openai-compatible');
    expect(view.provider?.credentialRef).toBe('safe-storage:openai-compatible');
  });

  it('update preserves a stored key when host/adapter are unchanged', async () => {
    await providerConfig.updateProviderConfig(VALID_PROVIDER_CONFIG);
    await providerConfig.setApiKey('deepseek-primary', 'sk-secret');
    const view = await handlers.update({
      provider: {
        displayName: 'deepseek-primary',
        adapterType: 'DEEPSEEK',
        baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-chat',
      },
    });
    expect(view.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(view)).not.toContain('sk-secret');
  });

  it('update invalidates a stored key when the host changes under the same providerId', async () => {
    await providerConfig.updateProviderConfig(VALID_PROVIDER_CONFIG);
    await providerConfig.setApiKey('deepseek-primary', 'sk-secret');
    const view = await handlers.update({
      provider: {
        displayName: 'deepseek-primary',
        adapterType: 'DEEPSEEK',
        baseUrl: 'https://api.deepseek.com/v2',
        modelId: 'deepseek-chat-v2',
      },
    });
    expect(view.apiKeyConfigured).toBe(false);
  });

  it('update rejects unsupported ANTHROPIC_MESSAGES adapter', async () => {
    await expect(
      handlers.update({
        provider: {
          displayName: 'Anthropic',
          adapterType: 'ANTHROPIC_MESSAGES',
          baseUrl: 'https://api.anthropic.com',
          modelId: 'claude',
        },
      }),
    ).rejects.toThrow(/配置内容不合法/);
  });

  it('update rejects empty and unknown-field payloads', async () => {
    await expect(handlers.update({})).rejects.toThrow(/配置内容不合法/);
    await expect(handlers.update({ roomReference: 'room', foo: 1 })).rejects.toThrow();
  });

  it('update persists a custom system prompt with a fresh template version', async () => {
    const view = await handlers.update({ systemPrompt: '  新指令模板  ' });
    expect(view.prompt?.systemPromptTemplate).toBe('新指令模板');
    expect(view.prompt?.templateVersion).toMatch(/^custom-/);
    expect(view.prompt?.updatedAt).toBeTruthy();
  });

  it('update clears a custom system prompt back to the code default via empty string', async () => {
    await handlers.update({ systemPrompt: '临时模板' });
    expect((await handlers.get()).prompt?.systemPromptTemplate).toBe('临时模板');
    const view = await handlers.update({ systemPrompt: '' });
    expect(view.prompt).toBeUndefined();
  });

  it('corrupt settings file produces a user-readable error without internals', async () => {
    await mkdir(join(testDir, 'config'), { recursive: true });
    await writeFile(join(testDir, 'config', 'settings.json'), '{ not json', 'utf-8');
    await expect(handlers.get()).rejects.toThrow(/配置读取失败/);
  });

  it('updateOverlay persists overlay prefs and returns them', async () => {
    const prefs = await handlers.updateOverlay({
      durationMs: 20000,
      width: 900,
      height: 240,
      opacity: 0.8,
      fontScale: 1.1,
      theme: 'light',
      clickThrough: true,
    });
    expect(prefs.durationMs).toBe(20000);
    const view = await handlers.get();
    expect(view.overlay).toEqual(prefs);
  });

  it('updateOverlay rejects out-of-range and partial payloads with a Chinese message', async () => {
    await expect(
      handlers.updateOverlay({
        durationMs: 999,
        width: 900,
        height: 240,
        opacity: 0.8,
        fontScale: 1.1,
        theme: 'light',
        clickThrough: false,
      }),
    ).rejects.toThrow('浮窗偏好不合法');
    await expect(handlers.updateOverlay({ durationMs: 10000 })).rejects.toThrow('浮窗偏好不合法');
  });

  it('updateOverlay rejects unknown fields via the strict schema', async () => {
    await expect(
      handlers.updateOverlay({
        durationMs: 10000,
        width: 900,
        height: 240,
        opacity: 0.8,
        fontScale: 1.1,
        theme: 'light',
        clickThrough: false,
        position: 'center',
      }),
    ).rejects.toThrow('浮窗偏好不合法');
  });

  it('updateOverlay enforces the contract bounds at the edges', async () => {
    await expect(
      handlers.updateOverlay({
        durationMs: 1000,
        width: 320,
        height: 120,
        opacity: 0.19,
        fontScale: 1,
        theme: 'dark',
        clickThrough: false,
      }),
    ).rejects.toThrow('浮窗偏好不合法');
    const max = await handlers.updateOverlay({
      durationMs: 60000,
      width: 1920,
      height: 1080,
      opacity: 1,
      fontScale: 2,
      theme: 'dark',
      clickThrough: false,
    });
    expect(max.durationMs).toBe(60000);
  });

  it('updateOverlay live-applies to the overlay window when provided (M6-07 wire)', async () => {
    const applyPreferences = vi.fn().mockResolvedValue(undefined);
    const withWindow = createConfigControlHandlers({
      settings,
      providerConfig,
      overlayWindow: { applyPreferences },
    });
    const prefs = {
      durationMs: 10000,
      width: 800,
      height: 200,
      opacity: 0.95,
      fontScale: 1,
      theme: 'dark',
      clickThrough: false,
    };
    await withWindow.updateOverlay(prefs);
    expect(applyPreferences).toHaveBeenCalledWith(prefs);
  });

  it('updateOverlay live-applies visual prefs to the history feed (history-window)', async () => {
    const applyVisualPrefs = vi.fn();
    const withHistory = createConfigControlHandlers({
      settings,
      providerConfig,
      history: { applyCapacity: vi.fn(), applyVisualPrefs },
    });
    const prefs = {
      durationMs: 10000,
      width: 800,
      height: 200,
      opacity: 0.95,
      fontScale: 1,
      theme: 'dark',
      clickThrough: false,
    };
    await withHistory.updateOverlay(prefs);
    expect(applyVisualPrefs).toHaveBeenCalledWith(prefs);
  });

  it('updateOverlay keeps a successful save even when live-apply fails', async () => {
    const applyPreferences = vi.fn().mockRejectedValue(new Error('window destroyed'));
    const withWindow = createConfigControlHandlers({
      settings,
      providerConfig,
      overlayWindow: { applyPreferences },
    });
    const prefs = {
      durationMs: 10000,
      width: 800,
      height: 200,
      opacity: 0.95,
      fontScale: 1,
      theme: 'dark',
      clickThrough: false,
    };
    await expect(withWindow.updateOverlay(prefs)).resolves.toEqual(prefs);
    const view = await handlers.get();
    expect(view.overlay.durationMs).toBe(10000);
  });
});
