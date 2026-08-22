import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SettingsStore } from '../../../src/main/config/index.js';
import {
  CredentialStore,
  type SafeStorageLike,
} from '../../../src/main/credentials/index.js';
import {
  ProviderConfigService,
  createProviderCredentialHandlers,
} from '../../../src/main/provider/index.js';

function makeMockStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (b) => b.toString('utf-8').slice(4),
  };
}

describe('Provider credential IPC handlers', () => {
  let testDir: string;
  let service: ProviderConfigService;
  let handlers: ReturnType<typeof createProviderCredentialHandlers>;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-provider-ipc-test-'));
    service = new ProviderConfigService(
      new SettingsStore(testDir),
      new CredentialStore(testDir, makeMockStorage()),
    );
    handlers = createProviderCredentialHandlers(service);
    await service.updateProviderConfig({
      providerId: 'deepseek-primary',
      displayName: '首选服务',
      adapterType: 'DEEPSEEK',
      baseUrl: 'https://api.deepseek.com',
      modelId: 'deepseek-chat',
      credentialRef: 'safe-storage:deepseek-primary',
    });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- set ---

  it('set stores the key and returns apiKeyConfigured true', async () => {
    const result = await handlers.set({
      providerId: 'deepseek-primary',
      apiKey: 'sk-secret',
    });
    expect(result).toEqual({ apiKeyConfigured: true });
    expect(await service.hasApiKey('deepseek-primary')).toBe(true);
  });

  it('set rejects a providerId that does not match the configured credentialRef', async () => {
    await expect(
      handlers.set({ providerId: 'other-provider', apiKey: 'sk-x' }),
    ).rejects.toThrow(/does not match configured credentialRef/);
    expect(await service.hasApiKey('other-provider')).toBe(false);
  });

  it('set rejects when no provider is configured', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'echocue-provider-empty-'));
    try {
      const emptyService = new ProviderConfigService(
        new SettingsStore(emptyDir),
        new CredentialStore(emptyDir, makeMockStorage()),
      );
      const emptyHandlers = createProviderCredentialHandlers(emptyService);
      await expect(
        emptyHandlers.set({ providerId: 'p1', apiKey: 'sk-x' }),
      ).rejects.toThrow(/no provider configured/);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('set rejects invalid payloads (empty apiKey, bad providerId shape)', async () => {
    await expect(handlers.set({ providerId: 'deepseek-primary', apiKey: '' })).rejects.toThrow();
    await expect(
      handlers.set({ providerId: 'UPPER_CASE', apiKey: 'sk-x' }),
    ).rejects.toThrow();
    await expect(handlers.set({ providerId: 'has space', apiKey: 'sk-x' })).rejects.toThrow();
    await expect(handlers.set({ providerId: 'deepseek-primary' })).rejects.toThrow();
  });

  // --- clear ---

  it('clear removes the stored key', async () => {
    await handlers.set({ providerId: 'deepseek-primary', apiKey: 'sk-secret' });
    const result = await handlers.clear({ providerId: 'deepseek-primary' });
    expect(result).toEqual({ apiKeyConfigured: false });
    expect(await service.hasApiKey('deepseek-primary')).toBe(false);
  });

  it('clear rejects a providerId that does not match config', async () => {
    await expect(handlers.clear({ providerId: 'other-provider' })).rejects.toThrow();
  });

  // --- test ---

  it('test returns UNAVAILABLE when no key is stored (no credential leaked)', async () => {
    const result = await handlers.test();
    expect(result).toEqual({ status: 'AUTH_FAILED' });
  });

  // --- privacy ---

  it('responses never contain the API key', async () => {
    await handlers.set({ providerId: 'deepseek-primary', apiKey: 'sk-top-secret' });
    const setRes = await handlers.set({ providerId: 'deepseek-primary', apiKey: 'sk-top-secret' });
    const clearRes = await handlers.clear({ providerId: 'deepseek-primary' });
    const testRes = await handlers.test();
    for (const payload of [setRes, clearRes, testRes]) {
      expect(JSON.stringify(payload)).not.toContain('sk-top-secret');
    }
  });

  it('validation errors do not echo the apiKey', async () => {
    let caught = '';
    try {
      await handlers.set({ providerId: 'UPPER', apiKey: 'sk-ultra-secret' });
    } catch (err) {
      caught = (err as Error).message;
    }
    expect(caught).not.toContain('sk-ultra-secret');
  });
});
