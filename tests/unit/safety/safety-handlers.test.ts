import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  SafetyPolicyStore,
  createSafetyControlHandlers,
} from '../../../src/main/safety/index.js';
import { CryptoKeyManager } from '../../../src/main/crypto/key-manager.js';
import { CredentialStore } from '../../../src/main/credentials/CredentialStore.js';
import { SettingsStore } from '../../../src/main/config/SettingsStore.js';

const MIGRATION_PATH = join(
  process.cwd(),
  'docs/06-data-interface/migrations/001_initial_schema.sql',
);

const mockStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf-8'),
};

const VALID_POLICY = '不要讨论主播住址和真实手机号；禁止回应具体交易价格。';
const INVALID_POLICY = '不合适的话题都不要说。';

// Sensitive-shaped strings that must never appear in any handler response.
const FORBIDDEN = [
  'sk-abc123',
  'Authorization: Bearer',
  'trace_id',
];

describe('Safety IPC handlers (M6-05)', () => {
  let testDir: string;
  let store: SafetyPolicyStore;
  let settingsStore: SettingsStore;
  let handlers: ReturnType<typeof createSafetyControlHandlers>;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-safety-ipc-test-'));
    const dbPath = join(testDir, 'audit.sqlite');
    const credStore = new CredentialStore(testDir, mockStorage);
    const keyManager = new CryptoKeyManager(credStore);
    await keyManager.ensureKeys('v1');
    settingsStore = new SettingsStore(testDir);
    store = new SafetyPolicyStore({
      dbPath,
      migrations: [{ version: 1, path: MIGRATION_PATH }],
      keyManager,
      keyVersion: 'v1',
      settingsStore,
    });
    handlers = createSafetyControlHandlers({ safety: store });
  });

  afterEach(async () => {
    store.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it('get returns an empty view for a fresh store', async () => {
    const view = await handlers.get();
    expect(view).toEqual({ activeVersion: null, current: null, versions: [] });
  });

  it('saveDraft compiles a valid policy into a DRAFT', async () => {
    const result = await handlers.saveDraft({ policyText: VALID_POLICY, keywords: ['直播间'] });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.versionMeta.status).toBe('DRAFT');
  });

  it('saveDraft surfaces compile errors for an INVALID policy', async () => {
    const result = await handlers.saveDraft({ policyText: INVALID_POLICY, keywords: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].clauseIndex).toBe(0);
    expect(result.errors[0].message).toContain('无法确定性解释');
    expect(result.versionMeta.status).toBe('INVALID');
  });

  it('get returns the latest draft as current content', async () => {
    await handlers.saveDraft({ policyText: VALID_POLICY, keywords: ['直播间', '报价'] });
    const view = await handlers.get();
    expect(view.current).not.toBeNull();
    expect(view.current?.policyText).toBe(VALID_POLICY);
    expect(view.current?.keywords).toEqual(['直播间', '报价']);
    expect(view.current?.validationErrors).toEqual([]);
    expect(view.versions).toHaveLength(1);
  });

  it('publish activates the version and updates the settings pointer', async () => {
    const draft = await handlers.saveDraft({ policyText: VALID_POLICY, keywords: [] });
    const published = await handlers.publish({ safetyPolicyVersion: draft.versionMeta.safetyPolicyVersion });
    expect(published.status).toBe('PUBLISHED');
    const settings = await settingsStore.get();
    expect(settings?.activeSafetyPolicyVersion).toBe(draft.versionMeta.safetyPolicyVersion);
  });

  it('get reports the published version as active', async () => {
    const draft = await handlers.saveDraft({ policyText: VALID_POLICY, keywords: [] });
    await handlers.publish({ safetyPolicyVersion: draft.versionMeta.safetyPolicyVersion });
    const view = await handlers.get();
    expect(view.activeVersion?.safetyPolicyVersion).toBe(draft.versionMeta.safetyPolicyVersion);
    expect(view.activeVersion?.status).toBe('PUBLISHED');
    // Editing continues from the published content once no draft exists.
    expect(view.current?.versionId).toBe(draft.versionMeta.safetyPolicyVersion);
  });

  it('a second draft supersedes the first on publish', async () => {
    const first = await handlers.saveDraft({ policyText: '不要讨论主播住址。', keywords: [] });
    await handlers.publish({ safetyPolicyVersion: first.versionMeta.safetyPolicyVersion });
    const second = await handlers.saveDraft({ policyText: '不要讨论主播住址和真实手机号。', keywords: [] });
    await handlers.publish({ safetyPolicyVersion: second.versionMeta.safetyPolicyVersion });
    const view = await handlers.get();
    const published = view.versions.filter((v) => v.status === 'PUBLISHED');
    expect(published).toHaveLength(1);
    expect(published[0].safetyPolicyVersion).toBe(second.versionMeta.safetyPolicyVersion);
    expect(view.activeVersion?.safetyPolicyVersion).toBe(second.versionMeta.safetyPolicyVersion);
    const firstMeta = view.versions.find((v) => v.safetyPolicyVersion === first.versionMeta.safetyPolicyVersion);
    expect(firstMeta?.status).toBe('SUPERSEDED');
  });

  it('publish rejects an INVALID version with a Chinese message', async () => {
    const draft = await handlers.saveDraft({ policyText: INVALID_POLICY, keywords: [] });
    await expect(handlers.publish({ safetyPolicyVersion: draft.versionMeta.safetyPolicyVersion })).rejects.toThrow(
      '该版本未通过校验，不能发布',
    );
  });

  it('publish rejects a non-DRAFT version', async () => {
    const draft = await handlers.saveDraft({ policyText: VALID_POLICY, keywords: [] });
    await handlers.publish({ safetyPolicyVersion: draft.versionMeta.safetyPolicyVersion });
    await expect(handlers.publish({ safetyPolicyVersion: draft.versionMeta.safetyPolicyVersion })).rejects.toThrow(
      '仅未发布的草稿可发布，已发布版本不可修改',
    );
  });

  it('publish rejects an unknown version', async () => {
    await expect(handlers.publish({ safetyPolicyVersion: 'sp-missing' })).rejects.toThrow(
      '安全策略版本不存在',
    );
  });

  it('saveDraft rejects an over-long keyword via schema', async () => {
    await expect(handlers.saveDraft({ policyText: '', keywords: ['x'.repeat(65)] })).rejects.toThrow(
      '安全策略内容不合法',
    );
  });

  it('publish rejects a malformed request', async () => {
    await expect(handlers.publish({ safetyPolicyVersion: '' })).rejects.toThrow('版本标识不合法');
  });

  it('never leaks keys, authorization, or trace ids in any response or error', async () => {
    const responses: unknown[] = [];
    responses.push(await handlers.get());
    responses.push(await handlers.saveDraft({ policyText: VALID_POLICY, keywords: ['sk-abc123'] }));
    // Error instances serialize to {} under JSON.stringify; stringify the
    // message so the error path is really covered.
    await handlers.publish({ safetyPolicyVersion: 'sp-missing' }).catch((err: unknown) => {
      responses.push(String(err));
    });

    for (const payload of responses) {
      const serialized = JSON.stringify(payload);
      for (const forbidden of FORBIDDEN) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });

  it('keeps the rejected INVALID draft as current content so errors stay visible', async () => {
    const draft = await handlers.saveDraft({ policyText: INVALID_POLICY, keywords: [] });
    const view = await handlers.get();
    expect(view.current).not.toBeNull();
    expect(view.current?.versionId).toBe(draft.versionMeta.safetyPolicyVersion);
    expect(view.current?.policyText).toBe(INVALID_POLICY);
    expect(view.current?.validationErrors.length).toBeGreaterThan(0);
    expect(view.current?.validationErrors[0].message).toContain('无法确定性解释');
  });

  it('never exposes compiledRules in any handler response', async () => {
    const result = await handlers.saveDraft({ policyText: VALID_POLICY, keywords: [] });
    const view = await handlers.get();
    expect('compiledRules' in (view as object)).toBe(false);
    expect(view.current).not.toBeNull();
    expect('compiledRules' in (view.current as object)).toBe(false);
    expect('compiledRules' in (result as object)).toBe(false);
    expect('compiledRules' in (result.versionMeta as object)).toBe(false);
  });
});
