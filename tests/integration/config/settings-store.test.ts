import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SettingsStore, ConfigCorruptError } from '../../../src/main/config/index.js';

describe('SettingsStore', () => {
  let testDir: string;
  let store: SettingsStore;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-settings-test-'));
    store = new SettingsStore(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- Normal path ---

  it('returns null when settings file does not exist', async () => {
    expect(await store.get()).toBeNull();
  });

  it('writes default settings and reads them back', async () => {
    await store.reset();
    const settings = await store.get();
    expect(settings).not.toBeNull();
    expect(settings!.schemaVersion).toBe(1);
    expect(settings!.overlay.durationMs).toBe(10000);
    expect(settings!.overlay.theme).toBe('dark');
  });

  it('update creates defaults then applies partial when no file exists', async () => {
    await store.update({ roomReference: 'room-123' });
    const settings = await store.get();
    expect(settings!.roomReference).toBe('room-123');
    expect(settings!.overlay.durationMs).toBe(10000);
  });

  it('update merges partial with existing settings', async () => {
    await store.reset();
    await store.update({ roomReference: 'room-abc' });
    const settings = await store.get();
    expect(settings!.roomReference).toBe('room-abc');
    expect(settings!.overlay.clickThrough).toBe(false);
  });

  it('update can change overlay preferences', async () => {
    await store.reset();
    await store.update({ overlay: { ...store.getDefaults().overlay, theme: 'light', opacity: 0.8 } });
    const settings = await store.get();
    expect(settings!.overlay.theme).toBe('light');
    expect(settings!.overlay.opacity).toBe(0.8);
  });

  it('update persists a custom system prompt and clears it via undefined', async () => {
    await store.update({
      prompt: {
        systemPromptTemplate: '自定义模板',
        templateVersion: 'custom-abc',
        updatedAt: '2026-08-23T00:00:00.000Z',
      },
    });
    const withPrompt = await store.get();
    expect(withPrompt!.prompt?.systemPromptTemplate).toBe('自定义模板');
    expect(withPrompt!.prompt?.templateVersion).toBe('custom-abc');
    // Clearing writes `prompt: undefined`, which JSON.stringify drops entirely.
    await store.update({ prompt: undefined });
    const cleared = await store.get();
    expect('prompt' in (cleared ?? {})).toBe(false);
  });

  // --- Corrupt / invalid file handling ---

  it('throws ConfigCorruptError on malformed JSON', async () => {
    await mkdir(join(testDir, 'config'), { recursive: true });
    await writeFile(join(testDir, 'config', 'settings.json'), '{ not valid json }', 'utf-8');
    await expect(store.get()).rejects.toBeInstanceOf(ConfigCorruptError);
  });

  it('throws ConfigCorruptError on extra unknown field (strict schema)', async () => {
    await mkdir(join(testDir, 'config'), { recursive: true });
    const bad = { ...store.getDefaults(), unexpectedField: 'oops' };
    await writeFile(join(testDir, 'config', 'settings.json'), JSON.stringify(bad), 'utf-8');
    await expect(store.get()).rejects.toBeInstanceOf(ConfigCorruptError);
  });

  it('throws ConfigCorruptError on wrong schemaVersion', async () => {
    await mkdir(join(testDir, 'config'), { recursive: true });
    const bad = { ...store.getDefaults(), schemaVersion: 99 };
    await writeFile(join(testDir, 'config', 'settings.json'), JSON.stringify(bad), 'utf-8');
    await expect(store.get()).rejects.toBeInstanceOf(ConfigCorruptError);
  });

  it('throws ConfigCorruptError on missing required overlay field', async () => {
    await mkdir(join(testDir, 'config'), { recursive: true });
    const defaults = store.getDefaults() as Record<string, unknown>;
    const bad = { ...defaults, overlay: { durationMs: 5000 } }; // missing most overlay fields
    await writeFile(join(testDir, 'config', 'settings.json'), JSON.stringify(bad), 'utf-8');
    await expect(store.get()).rejects.toBeInstanceOf(ConfigCorruptError);
  });

  // --- Schema validation on write ---

  it('rejects overlay durationMs below minimum (1000ms)', async () => {
    await store.reset();
    await expect(
      store.update({ overlay: { ...store.getDefaults().overlay, durationMs: 500 } })
    ).rejects.toThrow();
  });

  it('rejects overlay opacity out of range', async () => {
    await store.reset();
    await expect(
      store.update({ overlay: { ...store.getDefaults().overlay, opacity: 1.5 } })
    ).rejects.toThrow();
  });

  it('accepts valid provider config without API key', async () => {
    await store.reset();
    await store.update({
      provider: {
        providerId: 'deepseek-1',
        displayName: 'DeepSeek',
        adapterType: 'DEEPSEEK',
        baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-chat',
        credentialRef: 'deepseek-1',
      },
    });
    const settings = await store.get();
    expect(settings!.provider!.providerId).toBe('deepseek-1');
    expect((settings!.provider as Record<string, unknown>).apiKey).toBeUndefined();
  });

  it('rejects provider baseUrl with non-HTTPS scheme', async () => {
    await store.reset();
    await expect(
      store.update({
        provider: {
          providerId: 'p1',
          displayName: 'Test',
          adapterType: 'DEEPSEEK',
          baseUrl: 'http://api.insecure.com',
          modelId: 'model',
          credentialRef: 'p1',
        },
      })
    ).rejects.toThrow();
  });

  // --- Atomic write behaviour ---

  it('leaves settings.json unchanged when atomicWrite fails validation before write', async () => {
    await store.reset();
    const before = await store.get();
    await expect(
      store.update({ overlay: { ...store.getDefaults().overlay, durationMs: 0 } })
    ).rejects.toThrow();
    const after = await store.get();
    expect(after!.overlay.durationMs).toBe(before!.overlay.durationMs);
  });

  it('does not leave .tmp file after successful write', async () => {
    await store.reset();
    const tmpPath = join(testDir, 'config', 'settings.json.tmp');
    let tmpExists = true;
    try {
      await readFile(tmpPath);
    } catch {
      tmpExists = false;
    }
    expect(tmpExists).toBe(false);
  });

  // --- Default settings integrity ---

  it('getDefaults() passes SettingsV1Schema validation', async () => {
    const { SettingsV1Schema } = await import('@echocue/contracts');
    const defaults = store.getDefaults();
    expect(() => SettingsV1Schema.parse(defaults)).not.toThrow();
  });
});
