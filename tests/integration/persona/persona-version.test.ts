import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseSync } from 'node:sqlite';
import {
  PersonaStore,
  PersonaInvalidParamsError,
  PersonaNotFoundError,
  PersonaVersionNotFoundError,
  PersonaVersionImmutableError,
  PersonaContentDecryptionError,
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

const V1_CONTENT = '测试人设内容：第一版';
const V2_CONTENT = '测试人设内容：第二版';

describe('PersonaStore versions (T-PER-001)', () => {
  let testDir: string;
  let store: PersonaStore;
  let keyManager: CryptoKeyManager;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-persona-version-test-'));
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

  function openRawDb(): DatabaseSync {
    const raw = new DatabaseSync(join(testDir, 'audit.sqlite'));
    raw.exec('PRAGMA foreign_keys = ON');
    return raw;
  }

  function createPrincipal(): void {
    store.createPersona({ personaId: 'p1', displayName: 'P1', isPrincipal: true });
  }

  describe('draft and publish lifecycle', () => {
    it('creates a DRAFT and publishes it, switching active_version', () => {
      createPrincipal();
      expect(store.getPersona('p1').activeVersion).toBeNull();

      const meta = store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      expect(meta).toMatchObject({
        personaId: 'p1',
        status: 'DRAFT',
        publishedAt: null,
        createdFromVersion: null,
      });
      expect(meta.personaVersion).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(meta.contentHmac).toMatch(/^[0-9a-f]{64}$/);
      expect(store.getPersona('p1').activeVersion).toBeNull();
      expect(store.getPersona('p1').versionCount).toBe(1);

      store.publishDraft(meta.personaVersion);
      expect(store.getVersionMeta(meta.personaVersion).status).toBe('PUBLISHED');
      expect(store.getVersionMeta(meta.personaVersion).publishedAt).not.toBeNull();
      expect(store.getPersona('p1').activeVersion).toBe(meta.personaVersion);
    });

    it('publishing a second draft supersedes the first and switches active', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      store.publishDraft(v1.personaVersion);
      const v2 = store.createDraft({
        personaId: 'p1',
        content: V2_CONTENT,
        fromVersion: v1.personaVersion,
      });
      store.publishDraft(v2.personaVersion);

      expect(store.getVersionMeta(v1.personaVersion).status).toBe('SUPERSEDED');
      expect(store.getVersionMeta(v2.personaVersion)).toMatchObject({
        status: 'PUBLISHED',
        createdFromVersion: v1.personaVersion,
      });
      expect(store.getPersona('p1').activeVersion).toBe(v2.personaVersion);
      expect(store.listVersions('p1')).toHaveLength(2);
    });

    it('round-trips content through updateDraftContent', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      store.updateDraftContent(v1.personaVersion, V2_CONTENT);
      expect(store.readVersionContent(v1.personaVersion)).toBe(V2_CONTENT);
    });
  });

  describe('immutability', () => {
    it('rejects updating PUBLISHED and SUPERSEDED versions', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      store.publishDraft(v1.personaVersion);
      const v2 = store.createDraft({ personaId: 'p1', content: V2_CONTENT, fromVersion: v1.personaVersion });
      store.publishDraft(v2.personaVersion);

      expect(() => store.updateDraftContent(v1.personaVersion, 'x')).toThrowError(
        PersonaVersionImmutableError,
      );
      expect(() => store.updateDraftContent(v2.personaVersion, 'x')).toThrowError(
        PersonaVersionImmutableError,
      );
    });

    it('rejects re-publishing an already published version', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      store.publishDraft(v1.personaVersion);
      expect(() => store.publishDraft(v1.personaVersion)).toThrowError(PersonaVersionImmutableError);
    });
  });

  describe('rollback', () => {
    it('creates a new published version from the target and switches active', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      store.publishDraft(v1.personaVersion);
      const v2 = store.createDraft({ personaId: 'p1', content: V2_CONTENT, fromVersion: v1.personaVersion });
      store.publishDraft(v2.personaVersion);

      const raw = openRawDb();
      const hmacBefore = (
        raw.prepare('SELECT content_hmac FROM persona_version WHERE persona_version = ?').get(v1.personaVersion) as {
          content_hmac: string;
        }
      ).content_hmac;
      raw.close();

      const newId = store.rollbackTo('p1', v1.personaVersion);

      expect(newId).not.toBe(v1.personaVersion);
      expect(store.getVersionMeta(newId)).toMatchObject({
        personaId: 'p1',
        status: 'PUBLISHED',
        createdFromVersion: v1.personaVersion,
      });
      expect(store.getVersionMeta(newId).publishedAt).not.toBeNull();
      expect(store.readVersionContent(newId)).toBe(V1_CONTENT);
      expect(store.getPersona('p1').activeVersion).toBe(newId);
      expect(store.getVersionMeta(v2.personaVersion).status).toBe('SUPERSEDED');

      // Old rows stay content-immutable: v1 keeps its hmac, only a new row was added.
      expect(store.getVersionMeta(v1.personaVersion).status).toBe('SUPERSEDED');
      const raw2 = openRawDb();
      const hmacAfter = (
        raw2.prepare('SELECT content_hmac FROM persona_version WHERE persona_version = ?').get(v1.personaVersion) as {
          content_hmac: string;
        }
      ).content_hmac;
      expect(hmacAfter).toBe(hmacBefore);
      expect((raw2.prepare('SELECT COUNT(*) AS n FROM persona_version').get() as { n: number }).n).toBe(3);
      raw2.close();
    });

    it('produces a new row for identical content without dedup', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      store.publishDraft(v1.personaVersion);
      const newId = store.rollbackTo('p1', v1.personaVersion);

      expect(newId).not.toBe(v1.personaVersion);
      expect(store.compareVersions(v1.personaVersion, newId).sameContent).toBe(true);
      expect(store.listVersions('p1')).toHaveLength(2);
    });

    it('rejects rollback to a DRAFT version', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      store.publishDraft(v1.personaVersion);
      const draft2 = store.createDraft({ personaId: 'p1', content: V2_CONTENT, fromVersion: v1.personaVersion });

      expect(() => store.rollbackTo('p1', draft2.personaVersion)).toThrowError(PersonaInvalidParamsError);
    });

    it('rejects rollback to a version of another persona', () => {
      createPrincipal();
      store.createPersona({ personaId: 'p2', displayName: 'P2', isPrincipal: false });
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      store.publishDraft(v1.personaVersion);
      const v2 = store.createDraft({ personaId: 'p2', content: V2_CONTENT });
      store.publishDraft(v2.personaVersion);

      expect(() => store.rollbackTo('p1', v2.personaVersion)).toThrowError(PersonaInvalidParamsError);
      expect(store.getPersona('p1').activeVersion).toBe(v1.personaVersion);
    });
  });

  describe('comparison and reads', () => {
    it('compares content by hmac without decryption', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      store.publishDraft(v1.personaVersion);
      const v2 = store.createDraft({ personaId: 'p1', content: V2_CONTENT, fromVersion: v1.personaVersion });
      store.publishDraft(v2.personaVersion);

      const cmp = store.compareVersions(v1.personaVersion, v2.personaVersion);
      expect(cmp.sameContent).toBe(false);
      expect(cmp.a.personaVersion).toBe(v1.personaVersion);
      expect(cmp.a.status).toBe('SUPERSEDED');
      expect(cmp.b.status).toBe('PUBLISHED');
      expect(cmp.a.contentHmac).toBe(v1.contentHmac);
    });

    it('throws typed not-found errors for unknown version ids', () => {
      createPrincipal();
      expect(() => store.getVersionMeta('nope')).toThrowError(PersonaVersionNotFoundError);
      expect(() => store.readVersionContent('nope')).toThrowError(PersonaVersionNotFoundError);
      expect(() => store.updateDraftContent('nope', 'x')).toThrowError(PersonaVersionNotFoundError);
      expect(() => store.publishDraft('nope')).toThrowError(PersonaVersionNotFoundError);
      expect(() => store.compareVersions('nope', 'nope2')).toThrowError(PersonaVersionNotFoundError);
      expect(() => store.listVersions('nope-persona')).toThrowError(PersonaNotFoundError);
    });

    it('rejects invalid content and fromVersion parameters', () => {
      createPrincipal();
      store.createPersona({ personaId: 'p2', displayName: 'P2', isPrincipal: false });

      expect(() => store.createDraft({ personaId: 'p1', content: '' })).toThrowError(PersonaInvalidParamsError);
      expect(() => store.createDraft({ personaId: 'p1', content: '   ' })).toThrowError(
        PersonaInvalidParamsError,
      );
      expect(() =>
        store.createDraft({ personaId: 'p1', content: V1_CONTENT, fromVersion: '   ' }),
      ).toThrowError(PersonaInvalidParamsError);
      expect(() => store.createDraft({ personaId: 'nope', content: V1_CONTENT })).toThrowError(
        PersonaNotFoundError,
      );

      const v2 = store.createDraft({ personaId: 'p2', content: V2_CONTENT });
      expect(() =>
        store.createDraft({ personaId: 'p1', content: V1_CONTENT, fromVersion: v2.personaVersion }),
      ).toThrowError(PersonaInvalidParamsError);
    });
  });

  describe('error contract', () => {
    function codeOf(fn: () => void): string {
      try {
        fn();
      } catch (err) {
        return (err as { code?: string }).code ?? 'NO_CODE';
      }
      return 'NO_ERROR';
    }

    it('exposes stable error codes on every typed error', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      store.publishDraft(v1.personaVersion);

      expect(codeOf(() => store.getVersionMeta('nope'))).toBe('E_PERSONA_VERSION_NOT_FOUND');
      expect(codeOf(() => store.updateDraftContent(v1.personaVersion, 'x'))).toBe(
        'E_PERSONA_VERSION_IMMUTABLE',
      );
      expect(codeOf(() => store.createDraft({ personaId: 'p1', content: '' }))).toBe(
        'E_PERSONA_INVALID_PARAMS',
      );

      const raw = openRawDb();
      raw
        .prepare('UPDATE persona_version SET content_envelope = X\'0001\' WHERE persona_version = ?')
        .run(v1.personaVersion);
      raw.close();
      expect(codeOf(() => store.readVersionContent(v1.personaVersion))).toBe(
        'E_PERSONA_CONTENT_DECRYPTION_FAILED',
      );
    });
  });

  describe('DDL guard triggers', () => {
    it('rejects a parent version from another persona at the DB level', () => {
      createPrincipal();
      store.createPersona({ personaId: 'p2', displayName: 'P2', isPrincipal: false });
      store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      const v2 = store.createDraft({ personaId: 'p2', content: V2_CONTENT });

      const raw = openRawDb();
      expect(() =>
        raw
          .prepare(
            `INSERT INTO persona_version
               (persona_version, persona_id, status, content_envelope, content_hmac, created_at, published_at, created_from_version)
             VALUES (?,?,?,X'00',?,?,NULL,?)`,
          )
          .run(
            'ffffffff-0000-7000-8000-000000000001',
            'p1',
            'DRAFT',
            'h',
            new Date().toISOString(),
            v2.personaVersion,
          ),
      ).toThrowError(/invalid parent persona version/);
      raw.close();
    });

    it('rejects switching active_version to a non-PUBLISHED version at the DB level', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });

      const raw = openRawDb();
      expect(() =>
        raw.prepare("UPDATE persona SET active_version = ? WHERE persona_id = 'p1'").run(v1.personaVersion),
      ).toThrowError(/invalid active persona version/);
      raw.close();
    });
  });

  describe('encryption and privacy', () => {
    it('stores the envelope as an encrypted BLOB, never plaintext', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });

      const raw = openRawDb();
      const row = raw
        .prepare('SELECT content_envelope FROM persona_version WHERE persona_version = ?')
        .get(v1.personaVersion) as { content_envelope: Buffer };
      raw.close();

      const buf = Buffer.isBuffer(row.content_envelope)
        ? row.content_envelope
        : Buffer.from(row.content_envelope as unknown as Uint8Array);
      expect(buf.toString('utf-8')).not.toContain(V1_CONTENT);
      const parsed = JSON.parse(buf.toString('utf-8'));
      expect(parsed.alg).toBe('AES-256-GCM');
      expect(parsed).toHaveProperty('nonceB64');
      expect(parsed).toHaveProperty('ciphertextB64');
      expect(parsed).toHaveProperty('tagB64');
    });

    it('fails to decrypt a corrupted envelope with a typed error', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });

      const raw = openRawDb();
      raw
        .prepare('UPDATE persona_version SET content_envelope = X\'0001\' WHERE persona_version = ?')
        .run(v1.personaVersion);
      raw.close();

      expect(() => store.readVersionContent(v1.personaVersion)).toThrowError(PersonaContentDecryptionError);
    });

    it('fails to decrypt when the envelope was built for a different version', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      store.publishDraft(v1.personaVersion);
      const v2 = store.createDraft({ personaId: 'p1', content: V2_CONTENT, fromVersion: v1.personaVersion });
      store.publishDraft(v2.personaVersion);

      const raw = openRawDb();
      raw
        .prepare(
          `UPDATE persona_version SET content_envelope =
           (SELECT content_envelope FROM persona_version WHERE persona_version = ?)
           WHERE persona_version = ?`,
        )
        .run(v1.personaVersion, v2.personaVersion);
      raw.close();

      // The envelope authenticates against v1's AAD, so v2's read must fail.
      expect(() => store.readVersionContent(v2.personaVersion)).toThrowError(PersonaContentDecryptionError);
      expect(store.readVersionContent(v1.personaVersion)).toBe(V1_CONTENT);
    });

    it('keeps content out of all metadata output', () => {
      createPrincipal();
      const v1 = store.createDraft({ personaId: 'p1', content: V1_CONTENT });
      store.publishDraft(v1.personaVersion);
      const v2 = store.createDraft({ personaId: 'p1', content: V2_CONTENT, fromVersion: v1.personaVersion });
      store.publishDraft(v2.personaVersion);

      const outputs = [
        JSON.stringify(store.listVersions('p1')),
        JSON.stringify(store.getVersionMeta(v1.personaVersion)),
        JSON.stringify(store.compareVersions(v1.personaVersion, v2.personaVersion)),
        JSON.stringify(store.getPersona('p1')),
        JSON.stringify(store.createDraft({ personaId: 'p1', content: V1_CONTENT })),
      ];
      for (const out of outputs) {
        expect(out).not.toContain(V1_CONTENT);
        expect(out).not.toContain(V2_CONTENT);
        expect(out).not.toContain('content_envelope');
      }
    });
  });
});
