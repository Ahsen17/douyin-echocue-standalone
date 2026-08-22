import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ProviderConfigV1 } from '@echocue/contracts';
import { SettingsStore } from '../../../src/main/config/index.js';
import {
  CredentialStore,
  type SafeStorageLike,
} from '../../../src/main/credentials/index.js';
import { ProviderConfigService } from '../../../src/main/provider/index.js';
import type { ChatCompletionsProbe } from '../../../src/main/provider/index.js';

function makeMockStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (b) => b.toString('utf-8').slice(4),
  };
}

function makeConfig(overrides: Partial<ProviderConfigV1> = {}): ProviderConfigV1 {
  return {
    providerId: 'deepseek-primary',
    displayName: '首选服务',
    adapterType: 'DEEPSEEK',
    baseUrl: 'https://api.deepseek.com',
    modelId: 'deepseek-chat',
    credentialRef: 'safe-storage:deepseek-primary',
    ...overrides,
  };
}

describe('ProviderConfigService', () => {
  let testDir: string;
  let settings: SettingsStore;
  let credentials: CredentialStore;
  let service: ProviderConfigService;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-provider-config-test-'));
    settings = new SettingsStore(testDir);
    credentials = new CredentialStore(testDir, makeMockStorage());
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  function makeService(probe: ChatCompletionsProbe): ProviderConfigService {
    return new ProviderConfigService(settings, credentials, probe);
  }

  // --- get/update provider config ---

  it('returns null when no provider is configured', async () => {
    const svc = makeService(async () => ({ status: 200 }));
    expect(await svc.getProviderConfig()).toBeNull();
  });

  it('persists and reads back a valid provider config', async () => {
    const svc = makeService(async () => ({ status: 200 }));
    await svc.updateProviderConfig(makeConfig());
    const saved = await svc.getProviderConfig();
    expect(saved).toEqual(makeConfig());
  });

  it('rejects a non-HTTPS provider config', async () => {
    const svc = makeService(async () => ({ status: 200 }));
    await expect(svc.updateProviderConfig(makeConfig({ baseUrl: 'http://x.com' }))).rejects.toThrow();
    expect(await svc.getProviderConfig()).toBeNull();
  });

  // --- api key lifecycle ---

  it('setApiKey stores the key and hasApiKey reflects it', async () => {
    const svc = makeService(async () => ({ status: 200 }));
    await svc.setApiKey('deepseek-primary', 'sk-secret');
    expect(await svc.hasApiKey('deepseek-primary')).toBe(true);
    await svc.clearApiKey('deepseek-primary');
    expect(await svc.hasApiKey('deepseek-primary')).toBe(false);
  });

  it('hasApiKey is false when no key was stored', async () => {
    const svc = makeService(async () => ({ status: 200 }));
    expect(await svc.hasApiKey('deepseek-primary')).toBe(false);
  });

  it('updateProviderConfig invalidates the key when baseUrl changes', async () => {
    const svc = makeService(async () => ({ status: 200 }));
    await svc.updateProviderConfig(makeConfig());
    await svc.setApiKey('deepseek-primary', 'sk-old');
    await svc.updateProviderConfig(makeConfig({ baseUrl: 'https://api.other.com' }));
    expect(await svc.hasApiKey('deepseek-primary')).toBe(false);
  });

  it('updateProviderConfig keeps the key when only modelId changes', async () => {
    const svc = makeService(async () => ({ status: 200 }));
    await svc.updateProviderConfig(makeConfig());
    await svc.setApiKey('deepseek-primary', 'sk-keep');
    await svc.updateProviderConfig(makeConfig({ modelId: 'deepseek-chat-v2' }));
    expect(await svc.hasApiKey('deepseek-primary')).toBe(true);
  });

  // --- connection test three states ---

  it('testConnection returns OK on a 200 probe', async () => {
    const svc = makeService(async () => ({ status: 200 }));
    await svc.updateProviderConfig(makeConfig());
    await svc.setApiKey('deepseek-primary', 'sk-key');
    expect(await svc.testConnection()).toEqual({ status: 'OK' });
  });

  it('testConnection returns AUTH_FAILED on a 401 probe', async () => {
    const svc = makeService(async () => ({ status: 401 }));
    await svc.updateProviderConfig(makeConfig());
    await svc.setApiKey('deepseek-primary', 'sk-bad');
    expect(await svc.testConnection()).toEqual({ status: 'AUTH_FAILED' });
  });

  it('testConnection returns AUTH_FAILED on a 403 probe', async () => {
    const svc = makeService(async () => ({ status: 403 }));
    await svc.updateProviderConfig(makeConfig());
    await svc.setApiKey('deepseek-primary', 'sk-bad');
    expect(await svc.testConnection()).toEqual({ status: 'AUTH_FAILED' });
  });

  it('testConnection returns UNAVAILABLE when settings are corrupt', async () => {
    const { mkdir, writeFile } = await import('fs/promises');
    await mkdir(join(testDir, 'config'), { recursive: true });
    await writeFile(join(testDir, 'config', 'settings.json'), 'not json', 'utf-8');
    const svc = makeService(async () => ({ status: 200 }));
    expect(await svc.testConnection()).toEqual({ status: 'UNAVAILABLE' });
  });

  it('hasApiKey reads a key persisted by a previous store instance', async () => {
    // Simulate a prior launch: another store instance wrote the key to disk.
    const previous = new CredentialStore(testDir, makeMockStorage());
    await previous.setCredential('deepseek-primary', 'sk-persisted');
    // Fresh service/cache: hasApiKey must still see the on-disk key.
    const svc = makeService(async () => ({ status: 200 }));
    expect(await svc.hasApiKey('deepseek-primary')).toBe(true);
  });

  it('testConnection returns UNAVAILABLE on a 429/5xx probe', async () => {
    const svc = makeService(async () => ({ status: 429 }));
    await svc.updateProviderConfig(makeConfig());
    await svc.setApiKey('deepseek-primary', 'sk-key');
    expect(await svc.testConnection()).toEqual({ status: 'UNAVAILABLE' });

    const svc2 = makeService(async () => ({ status: 503 }));
    await svc2.updateProviderConfig(makeConfig());
    await svc2.setApiKey('deepseek-primary', 'sk-key');
    expect(await svc2.testConnection()).toEqual({ status: 'UNAVAILABLE' });
  });

  it('testConnection returns UNAVAILABLE when the probe throws (network/timeout)', async () => {
    const svc = makeService(async () => {
      throw new Error('boom');
    });
    await svc.updateProviderConfig(makeConfig());
    await svc.setApiKey('deepseek-primary', 'sk-key');
    expect(await svc.testConnection()).toEqual({ status: 'UNAVAILABLE' });
  });

  it('testConnection returns UNAVAILABLE when no provider is configured', async () => {
    const svc = makeService(async () => ({ status: 200 }));
    expect(await svc.testConnection()).toEqual({ status: 'UNAVAILABLE' });
  });

  it('testConnection returns AUTH_FAILED when no key is stored', async () => {
    const svc = makeService(async () => ({ status: 200 }));
    await svc.updateProviderConfig(makeConfig());
    expect(await svc.testConnection()).toEqual({ status: 'AUTH_FAILED' });
  });

  it('testConnection returns AUTH_FAILED for an invalid credentialRef', async () => {
    const svc = makeService(async () => ({ status: 200 }));
    await svc.updateProviderConfig(makeConfig({ credentialRef: 'keytar:unknown' }));
    await svc.setApiKey('deepseek-primary', 'sk-key');
    expect(await svc.testConnection()).toEqual({ status: 'AUTH_FAILED' });
  });

  it('testConnection passes the stored key to the probe and never returns it', async () => {
    let seenApiKey: string | undefined;
    const svc = makeService(async (input) => {
      seenApiKey = input.apiKey;
      return { status: 200 };
    });
    await svc.updateProviderConfig(makeConfig());
    await svc.setApiKey('deepseek-primary', 'sk-top-secret');
    const result = await svc.testConnection();
    expect(seenApiKey).toBe('sk-top-secret');
    expect(JSON.stringify(result)).not.toContain('sk-top-secret');
  });
});
