import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  CredentialStore,
  CredentialEncryptionUnavailableError,
  type SafeStorageLike,
} from '../../../src/main/credentials/index.js';
import type { ProviderConfigV1 } from '@echocue/contracts';

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

describe('CredentialStore', () => {
  let testDir: string;
  let store: CredentialStore;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-cred-test-'));
    store = new CredentialStore(testDir, makeMockStorage());
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- Normal path ---

  it('set then get returns the original key', async () => {
    await store.setCredential('deepseek-primary', 'sk-test-key');
    expect(await store.getCredential('deepseek-primary')).toBe('sk-test-key');
  });

  it('hasCredential is false initially', () => {
    expect(store.hasCredential('deepseek-primary')).toBe(false);
  });

  it('hasCredential is true after set, false after delete', async () => {
    await store.setCredential('deepseek-primary', 'sk-test-key');
    // Reload to populate cache
    const store2 = new CredentialStore(testDir, makeMockStorage());
    await store2.getCredential('deepseek-primary'); // triggers cache load
    await store2.setCredential('deepseek-primary', 'sk-test-key');
    expect(store2.hasCredential('deepseek-primary')).toBe(true);
    await store2.deleteCredential('deepseek-primary');
    expect(store2.hasCredential('deepseek-primary')).toBe(false);
  });

  it('multiple providerIds are isolated', async () => {
    await store.setCredential('provider-a', 'key-a');
    await store.setCredential('provider-b', 'key-b');
    expect(await store.getCredential('provider-a')).toBe('key-a');
    expect(await store.getCredential('provider-b')).toBe('key-b');
  });

  it('delete on non-existent providerId is a no-op', async () => {
    await expect(store.deleteCredential('does-not-exist')).resolves.toBeUndefined();
  });

  it('getCredential returns null when not set', async () => {
    expect(await store.getCredential('missing')).toBeNull();
  });

  // --- invalidateIfProviderChanged ---

  it('invalidates when baseUrl changes', async () => {
    await store.setCredential('deepseek-primary', 'sk-key');
    const old = makeConfig();
    const next = makeConfig({ baseUrl: 'https://api.other.com' });
    await store.invalidateIfProviderChanged(old, next);
    expect(await store.getCredential('deepseek-primary')).toBeNull();
  });

  it('invalidates when adapterType changes', async () => {
    await store.setCredential('deepseek-primary', 'sk-key');
    const old = makeConfig();
    const next = makeConfig({ adapterType: 'OPENAI_COMPATIBLE' });
    await store.invalidateIfProviderChanged(old, next);
    expect(await store.getCredential('deepseek-primary')).toBeNull();
  });

  it('keeps credential when host and adapter are unchanged', async () => {
    await store.setCredential('deepseek-primary', 'sk-key');
    const old = makeConfig();
    const next = makeConfig({ modelId: 'deepseek-chat-v2' });
    await store.invalidateIfProviderChanged(old, next);
    expect(await store.getCredential('deepseek-primary')).toBe('sk-key');
  });

  it('does nothing when oldConfig is undefined', async () => {
    await store.setCredential('deepseek-primary', 'sk-key');
    await store.invalidateIfProviderChanged(undefined, makeConfig());
    expect(await store.getCredential('deepseek-primary')).toBe('sk-key');
  });

  it('does nothing when providerId differs between old and new', async () => {
    await store.setCredential('provider-a', 'sk-key');
    const old = makeConfig({ providerId: 'provider-a', credentialRef: 'safe-storage:provider-a' });
    const next = makeConfig({ providerId: 'provider-b', credentialRef: 'safe-storage:provider-b' });
    await store.invalidateIfProviderChanged(old, next);
    expect(await store.getCredential('provider-a')).toBe('sk-key');
  });

  // --- parseCredentialRef / buildCredentialRef ---

  it('parseCredentialRef returns providerId for valid ref', () => {
    expect(CredentialStore.parseCredentialRef('safe-storage:deepseek-primary')).toBe('deepseek-primary');
    expect(CredentialStore.parseCredentialRef('safe-storage:a')).toBe('a');
    expect(CredentialStore.parseCredentialRef('safe-storage:provider-1_backup')).toBe('provider-1_backup');
  });

  it('parseCredentialRef returns null for invalid formats', () => {
    expect(CredentialStore.parseCredentialRef('keytar:foo')).toBeNull();
    expect(CredentialStore.parseCredentialRef('')).toBeNull();
    expect(CredentialStore.parseCredentialRef('safe-storage:')).toBeNull();
    expect(CredentialStore.parseCredentialRef('safe-storage:UPPER')).toBeNull();
    expect(CredentialStore.parseCredentialRef('safe-storage:has spaces')).toBeNull();
  });

  it('buildCredentialRef produces safe-storage: prefix', () => {
    expect(CredentialStore.buildCredentialRef('deepseek-primary')).toBe('safe-storage:deepseek-primary');
  });

  // --- Failure / error paths ---

  it('setCredential throws when safeStorage is unavailable', async () => {
    const unavailableStore = new CredentialStore(testDir, makeMockStorage(false));
    await expect(unavailableStore.setCredential('deepseek-primary', 'sk-key'))
      .rejects.toBeInstanceOf(CredentialEncryptionUnavailableError);
  });

  it('setCredential throws for invalid providerId format', async () => {
    await expect(store.setCredential('INVALID_ID', 'sk-key')).rejects.toThrow();
    await expect(store.setCredential('has spaces', 'sk-key')).rejects.toThrow();
    await expect(store.setCredential('', 'sk-key')).rejects.toThrow();
  });

  it('corrupt credentials.json is treated as empty without throwing', async () => {
    const { writeFile, mkdir } = await import('fs/promises');
    await mkdir(join(testDir, 'config'), { recursive: true });
    await writeFile(join(testDir, 'config', 'credentials.json'), 'not-json', 'utf-8');
    const corrupt = new CredentialStore(testDir, makeMockStorage());
    expect(await corrupt.getCredential('any')).toBeNull();
  });

  // --- Privacy ---

  it('CredentialEncryptionUnavailableError message does not contain any key value', () => {
    const err = new CredentialEncryptionUnavailableError();
    expect(err.message).not.toMatch(/sk-/);
    expect(err.message).not.toMatch(/key/i);
  });

  it('invalid providerId error does not echo the apiKey', async () => {
    let caughtMessage = '';
    try {
      await store.setCredential('BAD', 'sk-super-secret');
    } catch (e) {
      caughtMessage = (e as Error).message;
    }
    expect(caughtMessage).not.toContain('sk-super-secret');
  });
});
