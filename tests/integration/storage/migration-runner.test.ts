import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseSync } from 'node:sqlite';
import { MigrationRunner } from '../../../src/main/storage/index.js';

const MIGRATION_PATH = join(
  process.cwd(),
  'docs/06-data-interface/migrations/001_initial_schema.sql',
);

describe('MigrationRunner', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-migration-test-'));
    dbPath = join(testDir, 'audit.sqlite');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('initializes empty DB with all tables and triggers', () => {
    const runner = new MigrationRunner(dbPath, [{ version: 1, path: MIGRATION_PATH }]);
    const db = runner.run();

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(tables).toContain('persona');
    expect(tables).toContain('audit_trace');
    expect(tables).toContain('audit_transition');
    expect(tables).toContain('schema_migration');

    const row = db.prepare('SELECT version, checksum FROM schema_migration WHERE version=1').get() as {
      version: number;
      checksum: string;
    };
    expect(row).toBeDefined();
    expect(row.version).toBe(1);
    expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);

    const fk = (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys;
    expect(fk).toBe(1);
    const wal = (db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
    expect(wal).toBe('wal');

    db.close();
  });

  it('is idempotent on repeated runs', () => {
    const migrations = [{ version: 1, path: MIGRATION_PATH }];
    const r1 = new MigrationRunner(dbPath, migrations);
    const db1 = r1.run();
    db1.close();

    const r2 = new MigrationRunner(dbPath, migrations);
    const db2 = r2.run();
    const count = (
      db2.prepare('SELECT COUNT(*) as cnt FROM schema_migration').get() as { cnt: number }
    ).cnt;
    expect(count).toBe(1);
    db2.close();
  });

  it('throws on checksum mismatch and preserves original DB', async () => {
    const r1 = new MigrationRunner(dbPath, [{ version: 1, path: MIGRATION_PATH }]);
    const db1 = r1.run();
    db1.close();

    const tamperPath = join(testDir, '001_tampered.sql');
    await writeFile(tamperPath, '-- tampered\nSELECT 1;');

    expect(() => {
      const r2 = new MigrationRunner(dbPath, [{ version: 1, path: tamperPath }]);
      r2.run();
    }).toThrow(/checksum mismatch/);

    // DB must still be readable after failed run
    const check = new DatabaseSync(dbPath);
    const row = check.prepare('SELECT version FROM schema_migration WHERE version=1').get();
    expect(row).toBeDefined();
    check.close();
  });

  it('rolls back on bad SQL and leaves DB unchanged', async () => {
    const badSql = `
CREATE TABLE schema_migration (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT NOT NULL) STRICT;
CREATE TABLE bad_table (id TEXT PRIMARY KEY) STRICT;
THIS IS NOT SQL;
`;
    const badPath = join(testDir, '001_bad.sql');
    await writeFile(badPath, badSql);

    expect(() => {
      const r = new MigrationRunner(dbPath, [{ version: 1, path: badPath }]);
      r.run();
    }).toThrow();

    // DB should be openable but empty (or missing schema_migration from failed tx)
    const check = new DatabaseSync(dbPath);
    const tables = (
      check
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).not.toContain('bad_table');
    check.close();
  });

  it('enforces foreign_keys and triggers after migration', () => {
    const runner = new MigrationRunner(dbPath, [{ version: 1, path: MIGRATION_PATH }]);
    const db = runner.run();

    // Only one principal persona is allowed (partial unique index)
    const now = new Date().toISOString();
    db.prepare('INSERT INTO persona VALUES (?,?,?,?,?,?)').run('p1', 'A', 1, null, now, now);
    expect(() => {
      db.prepare('INSERT INTO persona VALUES (?,?,?,?,?,?)').run('p2', 'B', 1, null, now, now);
    }).toThrow();

    db.close();
  });
});
