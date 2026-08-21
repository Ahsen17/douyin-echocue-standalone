import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseSync } from 'node:sqlite';
import { SafetyPolicyStore, SafetyEngine } from '../../../src/main/safety/index.js';
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

describe('SafetyEngine (T-SAFE-001)', () => {
  let testDir: string;
  let store: SafetyPolicyStore;
  let keyManager: CryptoKeyManager;
  let settingsStore: SettingsStore;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-safety-engine-test-'));
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

  async function withActivePolicy(policyText = VALID_POLICY, keywords: string[] = []): Promise<void> {
    const meta = store.createDraft({ policyText, keywords });
    store.publishDraft(meta.safetyPolicyVersion);
    await store.activatePublishedVersion(meta.safetyPolicyVersion);
  }

  it('filters built-in PII against the frozen policy', async () => {
    await withActivePolicy();
    const engine = new SafetyEngine(store);
    const d = await engine.checkInput('你家具体住址和手机号是多少');
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe('PII');
    }
  });

  it('hits a compiled KEYWORD rule from the frozen policy', async () => {
    await withActivePolicy('', ['机密']);
    const engine = new SafetyEngine(store);
    const d = await engine.checkInput('这是公司机密');
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe('TEAM_FORBIDDEN');
      expect(d.matchedRule?.ruleType).toBe('KEYWORD');
    }
  });

  it('hits a compiled TOPIC_PHRASE rule from the frozen policy', async () => {
    await withActivePolicy('不要聊直播失误。');
    const engine = new SafetyEngine(store);
    const d = await engine.checkInput('不要聊直播失误哈');
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe('TEAM_FORBIDDEN');
      expect(d.matchedRule?.ruleType).toBe('TOPIC_PHRASE');
    }
  });

  it('allows safe text', async () => {
    await withActivePolicy();
    const engine = new SafetyEngine(store);
    const d = await engine.checkInput('今天状态真好，给大家分享一下吧');
    expect(d.allow).toBe(true);
  });

  it('fails closed when no active version is configured', async () => {
    const engine = new SafetyEngine(store);
    const d = await engine.checkInput('今天状态真好，给大家分享一下吧');
    expect(d).toEqual({ allow: false, reason: 'SAFETY_ENGINE_ERROR', matchedRule: null });
  });

  it('fails closed when the active pointer becomes stale', async () => {
    const v1 = store.createDraft({ policyText: VALID_POLICY, keywords: [] });
    store.publishDraft(v1.safetyPolicyVersion);
    await store.activatePublishedVersion(v1.safetyPolicyVersion);

    const v2 = store.createDraft({ policyText: '不要讨论具体优惠。', keywords: [] });
    store.publishDraft(v2.safetyPolicyVersion);
    // v1 is now SUPERSEDED but still the pointer target → fail closed.

    const engine = new SafetyEngine(store);
    const d = await engine.checkInput('今天状态真好');
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe('SAFETY_ENGINE_ERROR');
    }
  });

  it('fails closed when the compiled rules envelope is corrupted', async () => {
    await withActivePolicy();
    const raw = new DatabaseSync(join(testDir, 'audit.sqlite'));
    raw.exec(`UPDATE safety_policy_version SET compiled_rules_envelope = X'0001'`);
    raw.close();

    const engine = new SafetyEngine(store);
    const d = await engine.checkInput('今天状态真好');
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe('SAFETY_ENGINE_ERROR');
    }
  });
});
