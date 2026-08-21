import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseSync } from 'node:sqlite';
import {
  PersonaStore,
  PersonaStoreUnavailableError,
  PersonaNotFoundError,
  PersonaPrincipalConflictError,
  PersonaPrincipalDeletionError,
  PersonaReferencedError,
  AliasNotFoundError,
  AliasDuplicateError,
  PersonaInvalidParamsError,
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

describe('PersonaStore (T-PER-001)', () => {
  let testDir: string;
  let store: PersonaStore;
  let keyManager: CryptoKeyManager;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-persona-test-'));
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

  describe('persona lifecycle', () => {
    it('creates principal and member with aliases and exposes metadata', () => {
      store.createPersona({
        personaId: 'principal-1',
        displayName: '主播A',
        isPrincipal: true,
        aliases: [
          { aliasText: 'A', aliasKind: 'NAME' },
          { aliasText: '小A', aliasKind: 'NICKNAME' },
        ],
      });
      store.createPersona({
        personaId: 'member-1',
        displayName: '成员B',
        isPrincipal: false,
        aliases: [{ aliasText: 'B', aliasKind: 'NAME' }],
      });

      const principal = store.getPersona('principal-1');
      expect(principal).toMatchObject({
        personaId: 'principal-1',
        displayName: '主播A',
        isPrincipal: true,
        activeVersion: null,
        aliasCount: 2,
        versionCount: 0,
      });

      const all = store.listPersonas();
      expect(all).toHaveLength(2);
      expect(all[0].personaId).toBe('principal-1');
      expect(all[1].personaId).toBe('member-1');
      expect(all[1]).toMatchObject({ isPrincipal: false, aliasCount: 1 });

      // Batch aliases default to enabled=true and are trimmed on insert.
      const aliases = store.listAliases('principal-1');
      expect(aliases.map((a) => a.enabled)).toEqual([true, true]);
      expect(aliases.map((a) => a.aliasText).sort()).toEqual(['A', '小A']);
    });

    it('rejects duplicate alias text inside one createPersona batch', () => {
      expect(() =>
        store.createPersona({
          personaId: 'p',
          displayName: 'P',
          isPrincipal: false,
          aliases: [
            { aliasText: 'same', aliasKind: 'NAME' },
            { aliasText: ' same ', aliasKind: 'NICKNAME' },
          ],
        }),
      ).toThrowError(AliasDuplicateError);
      expect(() => store.getPersona('p')).toThrowError(PersonaNotFoundError);
    });

    it('rejects a second principal persona', () => {
      store.createPersona({ personaId: 'p1', displayName: 'P1', isPrincipal: true });

      expect(() =>
        store.createPersona({ personaId: 'p2', displayName: 'P2', isPrincipal: true }),
      ).toThrowError(PersonaPrincipalConflictError);

      const principal = store.listPersonas().find((p) => p.isPrincipal);
      expect(principal?.personaId).toBe('p1');
    });

    it('enforces single principal at the database index level', () => {
      store.createPersona({ personaId: 'p1', displayName: 'P1', isPrincipal: true });
      const raw = openRawDb();
      expect(() =>
        raw
          .prepare(
            `INSERT INTO persona (persona_id, display_name, is_principal, active_version, created_at, updated_at)
             VALUES ('p2', 'P2', 1, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
          )
          .run(),
      ).toThrow(/UNIQUE constraint failed/);
      raw.close();
    });

    it('renames a persona and promotes a member atomically', () => {
      store.createPersona({ personaId: 'p1', displayName: 'P1', isPrincipal: true });
      store.createPersona({ personaId: 'p2', displayName: 'P2', isPrincipal: false });

      store.updatePersona('p2', { displayName: 'P2-renamed', isPrincipal: true });

      expect(store.getPersona('p2')).toMatchObject({
        displayName: 'P2-renamed',
        isPrincipal: true,
      });
      expect(store.getPersona('p1').isPrincipal).toBe(false);
      expect(store.listPersonas().filter((p) => p.isPrincipal)).toHaveLength(1);
    });

    it('demotes a principal when explicitly requested', () => {
      store.createPersona({ personaId: 'p1', displayName: 'P1', isPrincipal: true });
      store.updatePersona('p1', { isPrincipal: false });
      expect(store.listPersonas().filter((p) => p.isPrincipal)).toHaveLength(0);
    });

    it('refuses to delete the principal persona', () => {
      store.createPersona({ personaId: 'p1', displayName: 'P1', isPrincipal: true });
      expect(() => store.deletePersona('p1')).toThrowError(PersonaPrincipalDeletionError);
      expect(store.getPersona('p1')).toBeDefined();
    });

    it('deletes a non-principal persona including its aliases', () => {
      store.createPersona({ personaId: 'p1', displayName: 'P1', isPrincipal: true });
      store.createPersona({
        personaId: 'p2',
        displayName: 'P2',
        isPrincipal: false,
        aliases: [{ aliasText: 'x', aliasKind: 'ALIAS' }],
      });

      store.deletePersona('p2');

      expect(() => store.getPersona('p2')).toThrowError(PersonaNotFoundError);
      const raw = openRawDb();
      expect((raw.prepare('SELECT COUNT(*) AS n FROM persona_alias').get() as { n: number }).n).toBe(0);
      expect((raw.prepare('SELECT COUNT(*) AS n FROM persona').get() as { n: number }).n).toBe(1);
      raw.close();
    });

    it('rejects deleting a persona referenced by suggestion_feedback', () => {
      store.createPersona({ personaId: 'p1', displayName: 'P1', isPrincipal: true });
      store.createPersona({ personaId: 'p2', displayName: 'P2', isPrincipal: false });

      const raw = openRawDb();
      const now = '2026-01-01T00:00:00.000Z';
      raw
        .prepare(
          `INSERT INTO live_session (session_id, room_reference, started_at)
           VALUES ('s1', 'room-1', ?)`,
        )
        .run(now);
      raw
        .prepare(
          `INSERT INTO audit_trace (trace_id, session_id, source_message_id, received_at, created_at)
           VALUES ('t1', 's1', 'm1', ?, ?)`,
        )
        .run(now, now);
      raw
        .prepare(
          `INSERT INTO persona_version (persona_version, persona_id, status, content_envelope, content_hmac, created_at)
           VALUES ('v1', 'p2', 'PUBLISHED', X'0001', 'hmac-1', ?)`,
        )
        .run(now);
      raw
        .prepare(
          `INSERT INTO suggestion_feedback
             (feedback_id, trace_id, revision_no, persona_id, persona_version, label_status, created_at)
           VALUES ('f1', 't1', 1, 'p2', 'v1', 'ACCEPTED', ?)`,
        )
        .run(now);

      expect(() => store.deletePersona('p2')).toThrowError(PersonaReferencedError);
      expect(store.getPersona('p2')).toBeDefined();
      raw.close();
    });

    it('throws typed not-found errors for unknown ids', () => {
      expect(() => store.getPersona('nope')).toThrowError(PersonaNotFoundError);
      expect(() => store.listAliases('nope')).toThrowError(PersonaNotFoundError);
      expect(() => store.updatePersona('nope', { displayName: 'x' })).toThrowError(
        PersonaNotFoundError,
      );
      expect(() => store.addAlias('nope', { aliasText: 'x', aliasKind: 'NAME' })).toThrowError(
        PersonaNotFoundError,
      );
      expect(() => store.deletePersona('nope')).toThrowError(PersonaNotFoundError);
      expect(() => store.deleteAlias('nope-alias')).toThrowError(AliasNotFoundError);
      expect(() => store.updateAlias('nope-alias', { enabled: false })).toThrowError(
        AliasNotFoundError,
      );
    });

    it('rejects invalid persona parameters', () => {
      expect(() =>
        store.createPersona({ personaId: '', displayName: 'x', isPrincipal: false }),
      ).toThrowError(PersonaInvalidParamsError);
      expect(() =>
        store.createPersona({ personaId: '   ', displayName: 'x', isPrincipal: false }),
      ).toThrowError(PersonaInvalidParamsError);
      expect(() =>
        store.createPersona({ personaId: 'p', displayName: '   ', isPrincipal: false }),
      ).toThrowError(PersonaInvalidParamsError);
      expect(() =>
        store.createPersona({
          personaId: 'p',
          displayName: 'x',
          isPrincipal: false,
          aliases: [{ aliasText: '  ', aliasKind: 'NAME' }],
        }),
      ).toThrowError(PersonaInvalidParamsError);
      expect(() =>
        store.createPersona({
          personaId: 'p',
          displayName: 'x',
          isPrincipal: false,
          aliases: [{ aliasText: 'ok', aliasKind: 'UNKNOWN' as never }],
        }),
      ).toThrowError(PersonaInvalidParamsError);
      store.createPersona({ personaId: 'p', displayName: 'x', isPrincipal: false });
      expect(() => store.updatePersona('p', { displayName: '   ' })).toThrowError(
        PersonaInvalidParamsError,
      );
    });
  });

  describe('alias CRUD', () => {
    it('adds, lists, updates and deletes aliases', () => {
      store.createPersona({ personaId: 'p', displayName: 'P', isPrincipal: false });

      const aliasId = store.addAlias('p', { aliasText: ' 小B ', aliasKind: 'NAME' });
      expect(aliasId).toBeTruthy();

      let aliases = store.listAliases('p');
      expect(aliases).toHaveLength(1);
      expect(aliases[0]).toMatchObject({
        personaId: 'p',
        aliasText: '小B',
        aliasKind: 'NAME',
        enabled: true,
      });

      store.updateAlias(aliasId, { aliasKind: 'NICKNAME', enabled: false });
      aliases = store.listAliases('p');
      expect(aliases[0]).toMatchObject({ aliasKind: 'NICKNAME', enabled: false });

      store.updateAlias(aliasId, { aliasText: 'B2' });
      expect(store.listAliases('p')[0].aliasText).toBe('B2');

      store.deleteAlias(aliasId);
      expect(store.listAliases('p')).toHaveLength(0);
      expect(() => store.deleteAlias(aliasId)).toThrowError(AliasNotFoundError);
    });

    it('rejects duplicate alias text within one persona but allows it across personas', () => {
      store.createPersona({ personaId: 'p1', displayName: 'P1', isPrincipal: true });
      store.createPersona({ personaId: 'p2', displayName: 'P2', isPrincipal: false });
      store.addAlias('p1', { aliasText: 'shared', aliasKind: 'NAME' });

      expect(() => store.addAlias('p1', { aliasText: 'shared', aliasKind: 'NICKNAME' })).toThrowError(
        AliasDuplicateError,
      );
      // DDL only enforces uniqueness per persona; cross-persona duplicates are legal.
      expect(() => store.addAlias('p2', { aliasText: 'shared', aliasKind: 'NAME' })).not.toThrow();
      expect(store.listAliases('p2')[0].aliasText).toBe('shared');
    });

    it('rejects updating an alias to text already taken in the same persona', () => {
      store.createPersona({ personaId: 'p', displayName: 'P', isPrincipal: false });
      const a1 = store.addAlias('p', { aliasText: 'one', aliasKind: 'NAME' });
      const a2 = store.addAlias('p', { aliasText: 'two', aliasKind: 'NAME' });

      expect(() => store.updateAlias(a2, { aliasText: 'one' })).toThrowError(AliasDuplicateError);
      expect(store.listAliases('p').map((a) => a.aliasText).sort()).toEqual(['one', 'two']);
    });

    it('rejects invalid alias parameters', () => {
      store.createPersona({ personaId: 'p', displayName: 'P', isPrincipal: false });
      expect(() => store.addAlias('p', { aliasText: '   ', aliasKind: 'NAME' })).toThrowError(
        PersonaInvalidParamsError,
      );
      expect(() =>
        store.addAlias('p', { aliasText: 'x', aliasKind: 'NOPE' as never }),
      ).toThrowError(PersonaInvalidParamsError);
      const a = store.addAlias('p', { aliasText: 'x', aliasKind: 'NAME' });
      expect(() => store.updateAlias(a, { aliasText: '  ' })).toThrowError(
        PersonaInvalidParamsError,
      );
      expect(() => store.updateAlias(a, { aliasKind: 'NOPE' as never })).toThrowError(
        PersonaInvalidParamsError,
      );
    });
  });

  describe('error contract and availability', () => {
    function codeOf(fn: () => void): string {
      try {
        fn();
      } catch (err) {
        return (err as { code?: string }).code ?? 'NO_CODE';
      }
      return 'NO_ERROR';
    }

    it('exposes stable error codes on every typed error', () => {
      store.createPersona({ personaId: 'p', displayName: 'P', isPrincipal: true });
      const aliasId = store.addAlias('p', { aliasText: 'a', aliasKind: 'NAME' });

      expect(codeOf(() => store.getPersona('nope'))).toBe('E_PERSONA_NOT_FOUND');
      expect(
        codeOf(() =>
          store.createPersona({ personaId: 'p2', displayName: 'P2', isPrincipal: true }),
        ),
      ).toBe('E_PERSONA_PRINCIPAL_CONFLICT');
      expect(codeOf(() => store.deletePersona('p'))).toBe('E_PERSONA_PRINCIPAL_DELETE_REJECTED');
      expect(codeOf(() => store.addAlias('p', { aliasText: 'a', aliasKind: 'ALIAS' }))).toBe(
        'E_PERSONA_ALIAS_DUPLICATE',
      );
      expect(codeOf(() => store.deleteAlias(aliasId + '-missing'))).toBe('E_ALIAS_NOT_FOUND');
      expect(
        codeOf(() => store.createPersona({ personaId: 'p3', displayName: ' ', isPrincipal: false })),
      ).toBe('E_PERSONA_INVALID_PARAMS');

      const raw = openRawDb();
      const now = '2026-01-01T00:00:00.000Z';
      raw
        .prepare(`INSERT INTO live_session (session_id, room_reference, started_at) VALUES ('s1','r1',?)`)
        .run(now);
      raw
        .prepare(
          `INSERT INTO audit_trace (trace_id, session_id, source_message_id, received_at, created_at) VALUES ('t1','s1','m1',?,?)`,
        )
        .run(now, now);
      raw
        .prepare(
          `INSERT INTO persona_version (persona_version, persona_id, status, content_envelope, content_hmac, created_at) VALUES ('v1','p','PUBLISHED',X'0001','hmac-1',?)`,
        )
        .run(now);
      raw
        .prepare(
          `INSERT INTO suggestion_feedback (feedback_id, trace_id, revision_no, persona_id, persona_version, label_status, created_at) VALUES ('f1','t1',1,'p','v1','ACCEPTED',?)`,
        )
        .run(now);
      raw.close();

      // A non-principal persona with the same FK reference chain yields the referenced error.
      store.createPersona({ personaId: 'p2', displayName: 'P2', isPrincipal: false });
      const raw2 = openRawDb();
      raw2
        .prepare(
          `INSERT INTO persona_version (persona_version, persona_id, status, content_envelope, content_hmac, created_at) VALUES ('v2','p2','PUBLISHED',X'0001','hmac-2',?)`,
        )
        .run(now);
      raw2
        .prepare(
          `INSERT INTO suggestion_feedback (feedback_id, trace_id, revision_no, persona_id, persona_version, label_status, created_at) VALUES ('f2','t1',2,'p2','v2','ACCEPTED',?)`,
        )
        .run(now);
      raw2.close();
      try {
        store.deletePersona('p2');
        expect.unreachable('deletePersona should have thrown');
      } catch (err) {
        expect((err as { code?: string }).code).toBe('E_PERSONA_REFERENCED');
        expect(String(err)).toContain('p2');
      }
    });

    it('throws PersonaStoreUnavailableError when the database is corrupt', async () => {
      const badDbPath = join(testDir, 'corrupt.sqlite');
      await writeFile(badDbPath, 'this is not a sqlite database');

      expect(() => {
        const failStore = new PersonaStore({
          dbPath: badDbPath,
          migrations: [{ version: 1, path: MIGRATION_PATH }],
          keyManager,
          keyVersion: 'v1',
        });
        failStore.close();
      }).toThrow(PersonaStoreUnavailableError);
    });
  });

  describe('privacy', () => {
    it('never exposes persona content in metadata output', () => {
      store.createPersona({
        personaId: 'p',
        displayName: 'P',
        isPrincipal: false,
        aliases: [{ aliasText: 'a', aliasKind: 'NAME' }],
      });
      // Seed a version row with an identifiable encrypted-payload marker so the
      // assertion can detect any content leak, not just column-name echoes.
      const raw = openRawDb();
      raw
        .prepare(
          `INSERT INTO persona_version (persona_version, persona_id, status, content_envelope, content_hmac, created_at)
           VALUES ('v1', 'p', 'PUBLISHED', ?, 'hmac-1', '2026-01-01T00:00:00.000Z')`,
        )
        .run(Buffer.from('ECHO_PRIVATE_MARKER_PERSONA_TEXT'));
      raw.close();

      const listed = JSON.stringify(store.listPersonas());
      const one = JSON.stringify(store.getPersona('p'));
      const aliases = JSON.stringify(store.listAliases('p'));
      for (const out of [listed, one, aliases]) {
        expect(out).not.toContain('ECHO_PRIVATE_MARKER_PERSONA_TEXT');
        expect(out).not.toContain('content_envelope');
      }
      expect(store.getPersona('p').versionCount).toBe(1);
    });
  });
});
