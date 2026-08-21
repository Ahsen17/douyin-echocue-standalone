import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  PersonaStore,
  PersonaRouter,
  PersonaRouterUnavailableError,
} from '../../../src/main/persona/index.js';
import { CryptoKeyManager } from '../../../src/main/crypto/key-manager.js';
import { CredentialStore } from '../../../src/main/credentials/CredentialStore.js';

const MIGRATION_PATH = join(
  process.cwd(),
  'docs/06-data-interface/migrations/001_initial_schema.sql',
);

const mockStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf-8'),
};

const PRINCIPAL_CONTENT = '主播阿远人设：热情、专业。';
const MEMBER_CONTENT = '成员小红人设：活泼、可爱。';

describe('PersonaRouter (T-PER-001)', () => {
  let testDir: string;
  let store: PersonaStore;
  let keyManager: CryptoKeyManager;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-persona-route-test-'));
    const dbPath = join(testDir, 'audit.sqlite');
    const credStore = new CredentialStore(testDir, mockStorage);
    keyManager = new CryptoKeyManager(credStore);
    await keyManager.ensureKeys('v1');

    store = new PersonaStore({
      dbPath,
      migrations: [{ version: 1, path: MIGRATION_PATH }],
      keyManager,
      keyVersion: 'v1',
    });
  });

  afterEach(async () => {
    store.close();
    await rm(testDir, { recursive: true, force: true });
  });

  function createPrincipal(): void {
    store.createPersona({
      personaId: 'principal',
      displayName: '阿远',
      isPrincipal: true,
      aliases: [{ aliasText: '阿远', aliasKind: 'NAME' }],
    });
  }

  function createMember(): void {
    store.createPersona({
      personaId: 'member',
      displayName: '小红',
      isPrincipal: false,
      aliases: [{ aliasText: '小红', aliasKind: 'NICKNAME' }],
    });
  }

  function publishActive(personaId: string, content: string): void {
    const draft = store.createDraft({ personaId, content });
    store.publishDraft(draft.personaVersion);
  }

  it('routes an exact member mention to that member persona snapshot', () => {
    createPrincipal();
    createMember();
    publishActive('principal', PRINCIPAL_CONTENT);
    publishActive('member', MEMBER_CONTENT);

    const router = new PersonaRouter(store);
    const route = router.route('小红今天状态真好');
    expect(route.decision).toBe('exact');
    expect(route.personaId).toBe('member');
    expect(route.personaMarkdown).toBe(MEMBER_CONTENT);
    expect(route.personaVersion).toBe(store.getPersona('member').activeVersion);
    expect(route.candidates).toContainEqual({ personaId: 'member', matchedAlias: '小红', score: 1 });
  });

  it('routes an unnamed message to the principal persona snapshot', () => {
    createPrincipal();
    publishActive('principal', PRINCIPAL_CONTENT);

    const router = new PersonaRouter(store);
    const route = router.route('今天状态真好，给大家分享一下吧');
    expect(route.decision).toBe('principal_fallback');
    expect(route.personaId).toBe('principal');
    expect(route.personaMarkdown).toBe(PRINCIPAL_CONTENT);
    expect(route.personaVersion).toBe(store.getPersona('principal').activeVersion);
  });

  it('falls back to the principal when the named member has no published version', () => {
    createPrincipal();
    createMember();
    publishActive('principal', PRINCIPAL_CONTENT);

    const router = new PersonaRouter(store);
    const route = router.route('小红加油');
    expect(route.decision).toBe('principal_fallback');
    expect(route.personaId).toBe('principal');
    expect(route.personaMarkdown).toBe(PRINCIPAL_CONTENT);
    // The exact candidate is still recorded for audit.
    expect(route.candidates).toContainEqual({ personaId: 'member', matchedAlias: '小红', score: 1 });
  });

  it('throws when the principal has no published version', () => {
    createPrincipal();

    const router = new PersonaRouter(store);
    expect(() => router.route('今天状态真好')).toThrowError(PersonaRouterUnavailableError);
  });

  it('throws a typed error with a stable code', () => {
    createPrincipal();
    const router = new PersonaRouter(store);
    try {
      router.route('今天状态真好');
      expect.unreachable();
    } catch (err) {
      expect((err as { code?: string }).code).toBe('E_PERSONA_ROUTE_UNAVAILABLE');
    }
  });
});
