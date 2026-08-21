import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseSync } from 'node:sqlite';
import {
  SafetyPolicyStore,
  SafetyPolicyUnavailableError,
  SafetyPolicyNotFoundError,
  SafetyPolicyInvalidError,
  SafetyPolicyImmutableError,
  SafetyPolicyInvalidParamsError,
  SafetyPolicyContentDecryptionError,
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

describe('SafetyPolicyStore (T-SAFE-001)', () => {
  let testDir: string;
  let store: SafetyPolicyStore;
  let keyManager: CryptoKeyManager;
  let settingsStore: SettingsStore;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-safety-policy-test-'));
    const dbPath = join(testDir, 'audit.sqlite');
    const credStore = new CredentialStore(testDir, mockStorage);
    keyManager = new CryptoKeyManager(credStore);
    await keyManager.ensureKeys('v1');
    settingsStore = new SettingsStore(testDir);

    store = new SafetyPolicyStore({
      dbPath,
      migrations: [{ version: 1, path: MIGRATION_PATH }],
      keyManager,
      keyVersion: 'v1',
      settingsStore,
    });
  });

  afterEach(async () => {
    store.close();
    await rm(testDir, { recursive: true, force: true });
  });

  function openRawDb(): DatabaseSync {
    const raw = new DatabaseSync(join(testDir, 'audit.sqlite'));
    raw.exec('PRAGMA foreign_keys = ON');
    return raw;
  }

  function codeOf(fn: () => void): string {
    try {
      fn();
    } catch (err) {
      return (err as { code?: string }).code ?? 'NO_CODE';
    }
    return 'NO_ERROR';
  }

  describe('draft lifecycle', () => {
    it('creates a valid DRAFT with compiled rules', () => {
      const meta = store.createDraft({ policyText: VALID_POLICY, keywords: ['最低价'] });
      expect(meta).toMatchObject({
        status: 'DRAFT',
        compilerVersion: 'SafetyRuleCompilerV1',
        publishedAt: null,
      });
      expect(meta.safetyPolicyVersion).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(store.listVersions()).toHaveLength(1);

      const content = store.readPolicy(meta.safetyPolicyVersion);
      expect(content.policyText).toBe(VALID_POLICY);
      expect(content.keywords).toEqual(['最低价']);
      expect(content.validationErrors).toBeNull();
      const categories = new Set((content.compiledRules ?? []).map((r) => r.category));
      expect(categories.has('PII')).toBe(true);
      expect(categories.has('TRANSACTION_PRICE')).toBe(true);
    });

    it('creates an INVALID draft with stored validation errors', () => {
      const meta = store.createDraft({ policyText: INVALID_POLICY, keywords: [] });
      expect(meta.status).toBe('INVALID');

      const content = store.readPolicy(meta.safetyPolicyVersion);
      expect(content.policyText).toBe(INVALID_POLICY);
      expect(content.compiledRules).toBeNull();
      expect(content.validationErrors).not.toBeNull();
      expect(content.validationErrors?.length).toBeGreaterThan(0);
    });
  });

  describe('publish', () => {
    it('publishes a DRAFT and supersedes the previous published version', () => {
      const v1 = store.createDraft({ policyText: VALID_POLICY, keywords: [] });
      store.publishDraft(v1.safetyPolicyVersion);
      expect(store.getVersionMeta(v1.safetyPolicyVersion)).toMatchObject({
        status: 'PUBLISHED',
      });
      expect(store.getVersionMeta(v1.safetyPolicyVersion).publishedAt).not.toBeNull();

      const v2 = store.createDraft({ policyText: '不要讨论具体优惠。', keywords: [] });
      store.publishDraft(v2.safetyPolicyVersion);
      expect(store.getVersionMeta(v1.safetyPolicyVersion).status).toBe('SUPERSEDED');
      expect(store.getVersionMeta(v2.safetyPolicyVersion).status).toBe('PUBLISHED');
      expect(store.listVersions()).toHaveLength(2);
    });

    it('blocks publishing an INVALID draft with E_SAFETY_POLICY_INVALID', () => {
      const meta = store.createDraft({ policyText: INVALID_POLICY, keywords: [] });
      expect(() => store.publishDraft(meta.safetyPolicyVersion)).toThrowError(SafetyPolicyInvalidError);
      expect(codeOf(() => store.publishDraft(meta.safetyPolicyVersion))).toBe('E_SAFETY_POLICY_INVALID');
    });

    it('rejects re-publishing an already published version', () => {
      const meta = store.createDraft({ policyText: VALID_POLICY, keywords: [] });
      store.publishDraft(meta.safetyPolicyVersion);
      expect(() => store.publishDraft(meta.safetyPolicyVersion)).toThrowError(SafetyPolicyImmutableError);
    });

    it('rolls back both updates when the publish transaction fails midway', () => {
      const v1 = store.createDraft({ policyText: VALID_POLICY, keywords: [] });
      store.publishDraft(v1.safetyPolicyVersion);
      const v2 = store.createDraft({ policyText: '不要讨论具体优惠。', keywords: [] });

      const raw = openRawDb();
      raw.exec(
        `CREATE TRIGGER inject_publish_failure BEFORE UPDATE ON safety_policy_version
         WHEN NEW.status = 'PUBLISHED' AND OLD.status = 'DRAFT'
         BEGIN SELECT RAISE(ABORT, 'injected publish failure'); END;`,
      );
      raw.close();

      expect(() => store.publishDraft(v2.safetyPolicyVersion)).toThrowError(SafetyPolicyUnavailableError);

      // No intermediate state: v2 stayed DRAFT, v1 stayed PUBLISHED.
      expect(store.getVersionMeta(v2.safetyPolicyVersion).status).toBe('DRAFT');
      expect(store.getVersionMeta(v1.safetyPolicyVersion).status).toBe('PUBLISHED');
    });
  });

  describe('activation', () => {
    it('writes activeSafetyPolicyVersion only for a PUBLISHED version', async () => {
      const draft = store.createDraft({ policyText: VALID_POLICY, keywords: [] });
      await expect(store.activatePublishedVersion(draft.safetyPolicyVersion)).rejects.toThrowError(
        SafetyPolicyInvalidParamsError,
      );

      store.publishDraft(draft.safetyPolicyVersion);
      await store.activatePublishedVersion(draft.safetyPolicyVersion);
      expect((await settingsStore.get())?.activeSafetyPolicyVersion).toBe(draft.safetyPolicyVersion);
      expect(await store.getActivePublishedVersion()).toBe(draft.safetyPolicyVersion);
    });

    it('rejects a non-UUIDv7 version id', async () => {
      await expect(store.activatePublishedVersion('nope')).rejects.toThrowError(SafetyPolicyInvalidParamsError);
    });

    it('fails closed when the active pointer becomes stale', async () => {
      const v1 = store.createDraft({ policyText: VALID_POLICY, keywords: [] });
      store.publishDraft(v1.safetyPolicyVersion);
      await store.activatePublishedVersion(v1.safetyPolicyVersion);
      expect(await store.getActivePublishedVersion()).toBe(v1.safetyPolicyVersion);

      const v2 = store.createDraft({ policyText: '不要讨论具体优惠。', keywords: [] });
      store.publishDraft(v2.safetyPolicyVersion);
      // v1 is now SUPERSEDED but still the pointer target → fail closed to null.
      expect(await store.getActivePublishedVersion()).toBeNull();

      await store.activatePublishedVersion(v2.safetyPolicyVersion);
      expect(await store.getActivePublishedVersion()).toBe(v2.safetyPolicyVersion);
    });

    it('returns null when no active version is configured', async () => {
      expect(await store.getActivePublishedVersion()).toBeNull();
    });

    it('returns null when the pointer references a missing version', async () => {
      await settingsStore.update({ activeSafetyPolicyVersion: 'ffffffff-0000-7000-8000-000000000000' });
      expect(await store.getActivePublishedVersion()).toBeNull();
    });
  });

  describe('encryption and privacy', () => {
    it('stores envelopes as encrypted BLOBs, never plaintext', () => {
      const meta = store.createDraft({ policyText: VALID_POLICY, keywords: [] });

      const raw = openRawDb();
      const row = raw
        .prepare('SELECT policy_text_envelope FROM safety_policy_version WHERE safety_policy_version = ?')
        .get(meta.safetyPolicyVersion) as { policy_text_envelope: Buffer };
      raw.close();

      const buf = Buffer.isBuffer(row.policy_text_envelope)
        ? row.policy_text_envelope
        : Buffer.from(row.policy_text_envelope as unknown as Uint8Array);
      expect(buf.toString('utf-8')).not.toContain('主播住址');
      const parsed = JSON.parse(buf.toString('utf-8'));
      expect(parsed.alg).toBe('AES-256-GCM');
      expect(parsed).toHaveProperty('nonceB64');
      expect(parsed).toHaveProperty('ciphertextB64');
      expect(parsed).toHaveProperty('tagB64');
    });

    it('fails to decrypt a corrupted envelope with a typed error', () => {
      const meta = store.createDraft({ policyText: VALID_POLICY, keywords: [] });

      const raw = openRawDb();
      raw
        .prepare("UPDATE safety_policy_version SET policy_text_envelope = X'0001' WHERE safety_policy_version = ?")
        .run(meta.safetyPolicyVersion);
      raw.close();

      expect(() => store.readPolicy(meta.safetyPolicyVersion)).toThrowError(SafetyPolicyContentDecryptionError);
      expect(codeOf(() => store.readPolicy(meta.safetyPolicyVersion))).toBe('E_SAFETY_POLICY_DECRYPTION_FAILED');
    });

    it('fails to decrypt when the envelope was built for a different version', () => {
      const v1 = store.createDraft({ policyText: VALID_POLICY, keywords: [] });
      const v2 = store.createDraft({ policyText: '不要讨论具体优惠。', keywords: [] });

      const raw = openRawDb();
      raw
        .prepare(
          `UPDATE safety_policy_version SET policy_text_envelope =
           (SELECT policy_text_envelope FROM safety_policy_version WHERE safety_policy_version = ?)
           WHERE safety_policy_version = ?`,
        )
        .run(v1.safetyPolicyVersion, v2.safetyPolicyVersion);
      raw.close();

      expect(() => store.readPolicy(v2.safetyPolicyVersion)).toThrowError(SafetyPolicyContentDecryptionError);
      expect(store.readPolicy(v1.safetyPolicyVersion).policyText).toBe(VALID_POLICY);
    });

    it('keeps policy content out of all metadata output', () => {
      const v1 = store.createDraft({ policyText: VALID_POLICY, keywords: ['最低价'] });
      store.publishDraft(v1.safetyPolicyVersion);
      store.createDraft({ policyText: INVALID_POLICY, keywords: [] });

      const outputs = [
        JSON.stringify(store.listVersions()),
        JSON.stringify(store.getVersionMeta(v1.safetyPolicyVersion)),
        JSON.stringify(store.createDraft({ policyText: '不要讨论具体优惠。', keywords: [] })),
      ];
      for (const out of outputs) {
        expect(out).not.toContain('主播住址');
        expect(out).not.toContain('最低价');
        expect(out).not.toContain('policy_text_envelope');
        expect(out).not.toContain('keywords_envelope');
        expect(out).not.toContain('compiled_rules_envelope');
        expect(out).not.toContain('validation_error_envelope');
      }
    });
  });

  describe('error contract', () => {
    it('throws typed not-found errors for unknown version ids', () => {
      expect(() => store.getVersionMeta('nope')).toThrowError(SafetyPolicyNotFoundError);
      expect(() => store.readPolicy('nope')).toThrowError(SafetyPolicyNotFoundError);
      expect(() => store.publishDraft('nope')).toThrowError(SafetyPolicyNotFoundError);
    });
  });
});
