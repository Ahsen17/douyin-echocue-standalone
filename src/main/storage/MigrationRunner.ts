import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface MigrationFile {
  version: number;
  path: string;
}

export class MigrationRunner {
  constructor(
    private readonly dbPath: string,
    private readonly migrations: MigrationFile[],
  ) {}

  run(): DatabaseSync {
    // node:sqlite does not create parent directories; the first launch must be
    // able to create the audit subdir inside a fresh user-data root.
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const db = new DatabaseSync(this.dbPath);
    try {
      db.exec('PRAGMA foreign_keys=ON');
      db.exec('PRAGMA journal_mode=WAL');
      db.exec('PRAGMA busy_timeout=5000');

      const hasMigrationTable = (db.prepare(
        "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='schema_migration'",
      ).get() as { cnt: number }).cnt > 0;

      const applied: Map<number, string> = new Map();
      if (hasMigrationTable) {
        const rows = db.prepare('SELECT version, checksum FROM schema_migration').all() as Array<{
          version: number;
          checksum: string;
        }>;
        for (const row of rows) {
          applied.set(row.version, row.checksum);
        }
      }

      const sorted = [...this.migrations].sort((a, b) => a.version - b.version);
      for (const mig of sorted) {
        const sql = readFileSync(mig.path, 'utf-8');
        const checksum = createHash('sha256').update(sql, 'utf-8').digest('hex');

        if (applied.has(mig.version)) {
          const storedChecksum = applied.get(mig.version)!;
          if (storedChecksum !== checksum) {
            throw new Error(
              `Migration ${mig.version} checksum mismatch: stored=${storedChecksum}, file=${checksum}`,
            );
          }
          continue;
        }

        db.exec('BEGIN');
        try {
          db.exec(sql);
          db.prepare(
            'INSERT INTO schema_migration (version, applied_at, checksum) VALUES (?,?,?)',
          ).run(mig.version, new Date().toISOString(), checksum);
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      }

      return db;
    } catch (err) {
      db.close();
      throw err;
    }
  }
}
