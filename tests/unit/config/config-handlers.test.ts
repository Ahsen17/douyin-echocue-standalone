import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  it('corrupt settings file produces a user-readable error without internals', async () => {
    await mkdir(join(testDir, 'config'), { recursive: true });
    await writeFile(join(testDir, 'config', 'settings.json'), '{ not json', 'utf-8');
    await expect(handlers.get()).rejects.toThrow(/配置读取失败/);
  });
});
