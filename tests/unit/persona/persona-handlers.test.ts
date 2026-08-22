import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  PersonaStore,
  createPersonaControlHandlers,
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

const CONTENT = '你是一位温柔真诚的主播，说话亲切自然。';

describe('Persona IPC handlers (M6-04)', () => {
  let testDir: string;
  let store: PersonaStore;
  let handlers: ReturnType<typeof createPersonaControlHandlers>;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-persona-ipc-test-'));
    const dbPath = join(testDir, 'audit.sqlite');
    const credStore = new CredentialStore(testDir, mockStorage);
    const keyManager = new CryptoKeyManager(credStore);
    await keyManager.ensureKeys('v1');
    store = new PersonaStore({
      dbPath,
      migrations: [{ version: 1, path: MIGRATION_PATH }],
      keyManager,
      keyVersion: 'v1',
    });
    handlers = createPersonaControlHandlers({ persona: store });
  });

  afterEach(async () => {
    store.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it('create makes the first member the principal and returns its summary', async () => {
    const created = await handlers.create({ displayName: '小A' });
    expect(created.isPrincipal).toBe(true);
    expect(created.activeVersion).toBeNull();
    const second = await handlers.create({ displayName: '阿哲' });
    expect(second.isPrincipal).toBe(false);
  });

  it('list reflects created members', async () => {
    await handlers.create({ displayName: '小A' });
    const list = await handlers.list();
    expect(list).toHaveLength(1);
    expect(list[0].displayName).toBe('小A');
  });

  it('saveDraft persists content and publish makes it the active version', async () => {
    const created = await handlers.create({ displayName: '小A' });
    const draft = await handlers.saveDraft({ personaId: created.personaId, content: CONTENT });
    expect(draft.status).toBe('DRAFT');

    const published = await handlers.publish({ personaVersion: draft.personaVersion });
    expect(published.status).toBe('PUBLISHED');

    const detail = await handlers.get({ personaId: created.personaId });
    expect(detail.editableContent).toBe(CONTENT);
    expect(detail.versions.some((v) => v.status === 'PUBLISHED')).toBe(true);
  });

  it('get returns the latest draft content after repeated saveDraft calls', async () => {
    const created = await handlers.create({ displayName: '小A' });
    await handlers.saveDraft({ personaId: created.personaId, content: '第一版草稿' });
    await handlers.saveDraft({ personaId: created.personaId, content: '第二版草稿' });
    const detail = await handlers.get({ personaId: created.personaId });
    expect(detail.editableContent).toBe('第二版草稿');
  });

  it('saveDraft with fromVersion copies the referenced version content (rollback)', async () => {
    const created = await handlers.create({ displayName: '小A' });
    await handlers.saveDraft({ personaId: created.personaId, content: '第一版内容' });
    const v1 = store.listVersions(created.personaId).find((v) => v.status === 'DRAFT');
    if (!v1) throw new Error('expected draft');
    const published = await handlers.publish({ personaVersion: v1.personaVersion });
    expect(published.status).toBe('PUBLISHED');

    const rolled = await handlers.saveDraft({ personaId: created.personaId, fromVersion: published.personaVersion });
    expect(rolled.status).toBe('DRAFT');
    expect(rolled.createdFromVersion).toBe(published.personaVersion);
  });

  it('setPrincipal switches the principal and keeps uniqueness', async () => {
    const a = await handlers.create({ displayName: '小A' });
    const b = await handlers.create({ displayName: '阿哲' });
    await handlers.setPrincipal({ personaId: b.personaId });
    const updated = await handlers.get({ personaId: b.personaId });
    expect(updated.summary.isPrincipal).toBe(true);
    expect((await handlers.list()).filter((p) => p.isPrincipal)).toHaveLength(1);
    expect(a.isPrincipal).toBe(true); // original snapshot is unchanged
  });

  it('delete refuses the principal persona with a user-readable message', async () => {
    const created = await handlers.create({ displayName: '小A' });
    await expect(handlers.delete({ personaId: created.personaId })).rejects.toThrow(
      /主要出镜人员不可删除/,
    );
  });

  it('updateAliases replaces the alias set (add + remove)', async () => {
    const created = await handlers.create({ displayName: '小A' });
    await handlers.updateAliases({
      personaId: created.personaId,
      aliases: [
        { aliasText: '阿A', aliasKind: 'NICKNAME' },
        { aliasText: '小A宝', aliasKind: 'NICKNAME' },
      ],
    });
    const rows = await handlers.updateAliases({
      personaId: created.personaId,
      aliases: [{ aliasText: '小A宝', aliasKind: 'NICKNAME' }],
    });
    expect(rows.map((r) => r.aliasText)).toEqual(['小A宝']);
  });

  it('compare reports content equality', async () => {
    const created = await handlers.create({ displayName: '小A' });
    const v1 = await handlers.saveDraft({ personaId: created.personaId, content: '相同内容' });
    const v2 = await handlers.saveDraft({ personaId: created.personaId, content: '相同内容' });
    const result = await handlers.compare({ a: v1.personaVersion, b: v2.personaVersion });
    expect(result.sameContent).toBe(true);
  });

  it('non-content responses never include persona text', async () => {
    const a = await handlers.create({ displayName: '小A' });
    const b = await handlers.create({ displayName: '阿哲' });
    const draft = await handlers.saveDraft({ personaId: a.personaId, content: CONTENT });
    const published = await handlers.publish({ personaVersion: draft.personaVersion });
    const list = await handlers.list();
    const versions = await handlers.listVersions({ personaId: a.personaId });
    const comparison = await handlers.compare({
      a: published.personaVersion,
      b: published.personaVersion,
    });
    const principal = await handlers.setPrincipal({ personaId: b.personaId });
    const aliases = await handlers.updateAliases({
      personaId: a.personaId,
      aliases: [{ aliasText: '阿A', aliasKind: 'NICKNAME' }],
    });
    for (const payload of [list, versions, a, published, comparison, principal, aliases]) {
      expect(JSON.stringify(payload)).not.toContain(CONTENT);
    }
  });
});
