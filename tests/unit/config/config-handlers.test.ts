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

  it('update rejects provider writes in this milestone (M6-03)', async () => {
    await expect(
      handlers.update({
        provider: {
          displayName: 'X',
          adapterType: 'DEEPSEEK',
          baseUrl: 'https://api.x.com',
          modelId: 'm',
        },
      }),
    ).rejects.toThrow(/提供商配置暂不可保存/);
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
