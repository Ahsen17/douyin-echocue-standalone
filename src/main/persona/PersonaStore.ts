import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { FieldEncryptor } from '../crypto/field-encryptor.js';
import { CryptoKeyManager } from '../crypto/key-manager.js';
import type { MigrationFile } from '../storage/MigrationRunner.js';
import { MigrationRunner } from '../storage/MigrationRunner.js';
import {
  ALIAS_KINDS_V1,
  type AliasInput,
  type AliasKind,
  type AliasRow,
  type CreatePersonaParams,
  type PersonaSummary,
  type UpdateAliasParams,
  type UpdatePersonaParams,
} from './types.js';

export interface PersonaStoreOptions {
  dbPath: string;
  migrations: MigrationFile[];
  keyManager: CryptoKeyManager;
  keyVersion: string;
}

export class PersonaStoreUnavailableError extends Error {
  readonly code = 'E_PERSONA_STORE_UNAVAILABLE';
  constructor(msg: string) {
    super(msg);
    this.name = 'PersonaStoreUnavailableError';
  }
}

export class PersonaNotFoundError extends Error {
  readonly code = 'E_PERSONA_NOT_FOUND';
  constructor(personaId: string) {
    super(`Persona not found: ${personaId}`);
    this.name = 'PersonaNotFoundError';
  }
}

export class PersonaPrincipalConflictError extends Error {
  readonly code = 'E_PERSONA_PRINCIPAL_CONFLICT';
  constructor(msg: string) {
    super(msg);
    this.name = 'PersonaPrincipalConflictError';
  }
}

export class PersonaPrincipalDeletionError extends Error {
  readonly code = 'E_PERSONA_PRINCIPAL_DELETE_REJECTED';
  constructor(personaId: string) {
    super(`Refusing to delete principal persona: ${personaId}`);
    this.name = 'PersonaPrincipalDeletionError';
  }
}

export class PersonaReferencedError extends Error {
  readonly code = 'E_PERSONA_REFERENCED';
  constructor(personaId: string) {
    super(`Persona is referenced by feedback/audit data and cannot be deleted: ${personaId}`);
    this.name = 'PersonaReferencedError';
  }
}

export class AliasNotFoundError extends Error {
  readonly code = 'E_ALIAS_NOT_FOUND';
  constructor(aliasId: string) {
    super(`Alias not found: ${aliasId}`);
    this.name = 'AliasNotFoundError';
  }
}

export class AliasDuplicateError extends Error {
  readonly code = 'E_PERSONA_ALIAS_DUPLICATE';
  constructor(personaId: string, aliasText: string) {
    super(`Alias already exists for persona ${personaId}: ${aliasText}`);
    this.name = 'AliasDuplicateError';
  }
}

export class PersonaInvalidParamsError extends Error {
  readonly code = 'E_PERSONA_INVALID_PARAMS';
  constructor(msg: string) {
    super(msg);
    this.name = 'PersonaInvalidParamsError';
  }
}

interface PersonaRow {
  persona_id: string;
  display_name: string;
  is_principal: number;
  active_version: string | null;
  created_at: string;
  updated_at: string;
  alias_count: number;
  version_count: number;
}

interface AliasDbRow {
  alias_id: string;
  persona_id: string;
  alias_text: string;
  alias_kind: string;
  enabled: number;
}

export class PersonaStore {
  private readonly db: DatabaseSync;
  private readonly encryptor: FieldEncryptor;

  constructor(private readonly options: PersonaStoreOptions) {
    const runner = new MigrationRunner(options.dbPath, options.migrations);
    try {
      this.db = runner.run();
    } catch (err) {
      throw new PersonaStoreUnavailableError(`Failed to open audit DB: ${String(err)}`);
    }
    const dek = options.keyManager.getDek(options.keyVersion);
    this.encryptor = new FieldEncryptor(dek, options.keyVersion);
  }

  close(): void {
    this.db.close();
  }

  createPersona(p: CreatePersonaParams): void {
    const personaId = p.personaId.trim();
    const displayName = p.displayName.trim();
    if (!personaId || !displayName) {
      throw new PersonaInvalidParamsError('personaId and displayName are required');
    }
    const aliases = (p.aliases ?? []).map((a) => ({ ...a, aliasText: a.aliasText.trim() }));
    for (const a of aliases) {
      validateAliasInput(a);
    }
    const seenAliasTexts = new Set<string>();
    for (const a of aliases) {
      if (seenAliasTexts.has(a.aliasText)) {
        throw new AliasDuplicateError(personaId, a.aliasText);
      }
      seenAliasTexts.add(a.aliasText);
    }

    if (p.isPrincipal && this.findPrincipalId() !== null) {
      throw new PersonaPrincipalConflictError('A principal persona already exists');
    }

    const now = new Date().toISOString();
    this.runTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO persona (persona_id, display_name, is_principal, active_version, created_at, updated_at)
           VALUES (?,?,?,?,?,?)`,
        )
        .run(personaId, displayName, p.isPrincipal ? 1 : 0, null, now, now);

      const insertAlias = this.db.prepare(
        `INSERT INTO persona_alias (alias_id, persona_id, alias_text, alias_kind, enabled)
         VALUES (?,?,?,?,?)`,
      );
      for (const a of aliases) {
        try {
          insertAlias.run(randomUUID(), personaId, a.aliasText, a.aliasKind, (a.enabled ?? true) ? 1 : 0);
        } catch (err) {
          if (isUniqueConstraintError(err)) {
            throw new AliasDuplicateError(personaId, a.aliasText);
          }
          throw err;
        }
      }
    });
  }

  updatePersona(personaId: string, params: UpdatePersonaParams): void {
    const row = this.getPersonaRow(personaId);

    const sets: string[] = [];
    const args: unknown[] = [];

    if (params.displayName !== undefined) {
      const displayName = params.displayName.trim();
      if (!displayName) {
        throw new PersonaInvalidParamsError('displayName must be non-empty');
      }
      sets.push('display_name = ?');
      args.push(displayName);
    }

    if (params.isPrincipal === true) {
      if (row.is_principal !== 1) {
        sets.push('is_principal = 1');
      }
      if (this.findPrincipalId() !== null && row.is_principal !== 1) {
        // Demotion of the current principal and promotion must land in the same
        // transaction so the partial unique index never observes two principals.
        this.runTransaction(() => {
          this.db
            .prepare('UPDATE persona SET is_principal = 0, updated_at = ? WHERE is_principal = 1')
            .run(new Date().toISOString());
          this.applyPersonaUpdate(personaId, sets, args);
        });
        return;
      }
    } else if (params.isPrincipal === false && row.is_principal === 1) {
      sets.push('is_principal = 0');
    }

    if (sets.length === 0) {
      return;
    }

    this.runTransaction(() => {
      this.applyPersonaUpdate(personaId, sets, args);
    });
  }

  private applyPersonaUpdate(personaId: string, sets: string[], args: unknown[]): void {
    sets.push('updated_at = ?');
    args.push(new Date().toISOString());
    args.push(personaId);
    this.db
      .prepare(`UPDATE persona SET ${sets.join(', ')} WHERE persona_id = ?`)
      .run(...(args as SQLInputValue[]));
  }

  getPersona(personaId: string): PersonaSummary {
    return this.mapPersonaRow(this.getPersonaRow(personaId));
  }

  listPersonas(): PersonaSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.persona_id, p.display_name, p.is_principal, p.active_version,
                p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM persona_alias a WHERE a.persona_id = p.persona_id) AS alias_count,
                (SELECT COUNT(*) FROM persona_version v WHERE v.persona_id = p.persona_id) AS version_count
         FROM persona p
         ORDER BY p.is_principal DESC, p.created_at ASC`,
      )
      .all() as unknown as PersonaRow[];
    return rows.map((r) => this.mapPersonaRow(r));
  }

  deletePersona(personaId: string): void {
    const row = this.getPersonaRow(personaId);
    if (row.is_principal === 1) {
      throw new PersonaPrincipalDeletionError(personaId);
    }

    this.runTransaction(
      () => {
        this.db.prepare('DELETE FROM persona_version WHERE persona_id = ?').run(personaId);
        this.db.prepare('DELETE FROM persona_alias WHERE persona_id = ?').run(personaId);
        this.db.prepare('DELETE FROM persona WHERE persona_id = ?').run(personaId);
      },
      personaId,
    );
  }

  listAliases(personaId: string): AliasRow[] {
    this.getPersonaRow(personaId);
    const rows = this.db
      .prepare(
        `SELECT alias_id, persona_id, alias_text, alias_kind, enabled
         FROM persona_alias WHERE persona_id = ? ORDER BY alias_text ASC`,
      )
      .all(personaId) as unknown as AliasDbRow[];
    return rows.map((r) => this.mapAliasRow(r));
  }

  addAlias(personaId: string, input: AliasInput): string {
    this.getPersonaRow(personaId);
    validateAliasInput(input);

    const aliasId = randomUUID();
    try {
      this.db
        .prepare(
          `INSERT INTO persona_alias (alias_id, persona_id, alias_text, alias_kind, enabled)
           VALUES (?,?,?,?,?)`,
        )
        .run(aliasId, personaId, input.aliasText.trim(), input.aliasKind, (input.enabled ?? true) ? 1 : 0);
      return aliasId;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AliasDuplicateError(personaId, input.aliasText.trim());
      }
      throw new PersonaStoreUnavailableError(`addAlias failed: ${String(err)}`);
    }
  }

  updateAlias(aliasId: string, params: UpdateAliasParams): void {
    const existing = this.getAliasRow(aliasId);
    if (params.aliasText !== undefined) {
      const text = params.aliasText.trim();
      if (!text) {
        throw new PersonaInvalidParamsError('aliasText must be non-empty');
      }
      params = { ...params, aliasText: text };
    }
    if (params.aliasKind !== undefined && !isAliasKind(params.aliasKind)) {
      throw new PersonaInvalidParamsError(`Invalid aliasKind: ${params.aliasKind}`);
    }

    const sets: string[] = [];
    const args: unknown[] = [];
    if (params.aliasText !== undefined) {
      sets.push('alias_text = ?');
      args.push(params.aliasText);
    }
    if (params.aliasKind !== undefined) {
      sets.push('alias_kind = ?');
      args.push(params.aliasKind);
    }
    if (params.enabled !== undefined) {
      sets.push('enabled = ?');
      args.push(params.enabled ? 1 : 0);
    }
    if (sets.length === 0) {
      return;
    }

    try {
      args.push(aliasId);
      this.db
        .prepare(`UPDATE persona_alias SET ${sets.join(', ')} WHERE alias_id = ?`)
        .run(...(args as SQLInputValue[]));
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AliasDuplicateError(existing.persona_id, params.aliasText ?? '');
      }
      throw new PersonaStoreUnavailableError(`updateAlias failed: ${String(err)}`);
    }
  }

  deleteAlias(aliasId: string): void {
    this.getAliasRow(aliasId);
    this.db.prepare('DELETE FROM persona_alias WHERE alias_id = ?').run(aliasId);
  }

  private getPersonaRow(personaId: string): PersonaRow {
    const row = this.db
      .prepare(
        `SELECT p.persona_id, p.display_name, p.is_principal, p.active_version,
                p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM persona_alias a WHERE a.persona_id = p.persona_id) AS alias_count,
                (SELECT COUNT(*) FROM persona_version v WHERE v.persona_id = p.persona_id) AS version_count
         FROM persona p WHERE p.persona_id = ?`,
      )
      .get(personaId) as PersonaRow | undefined;
    if (!row) {
      throw new PersonaNotFoundError(personaId);
    }
    return row;
  }

  private findPrincipalId(): string | null {
    const row = this.db
      .prepare('SELECT persona_id FROM persona WHERE is_principal = 1')
      .get() as { persona_id: string } | undefined;
    return row?.persona_id ?? null;
  }

  private getAliasRow(aliasId: string): AliasDbRow {
    const row = this.db
      .prepare('SELECT alias_id, persona_id, alias_text, alias_kind, enabled FROM persona_alias WHERE alias_id = ?')
      .get(aliasId) as AliasDbRow | undefined;
    if (!row) {
      throw new AliasNotFoundError(aliasId);
    }
    return row;
  }

  private mapPersonaRow(r: PersonaRow): PersonaSummary {
    return {
      personaId: r.persona_id,
      displayName: r.display_name,
      isPrincipal: r.is_principal === 1,
      activeVersion: r.active_version,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      aliasCount: r.alias_count,
      versionCount: r.version_count,
    };
  }

  private mapAliasRow(r: AliasDbRow): AliasRow {
    return {
      aliasId: r.alias_id,
      personaId: r.persona_id,
      aliasText: r.alias_text,
      aliasKind: r.alias_kind as AliasKind,
      enabled: r.enabled === 1,
    };
  }

  private runTransaction(body: () => void, referencedPersonaId?: string): void {
    try {
      this.db.exec('BEGIN');
    } catch (err) {
      throw new PersonaStoreUnavailableError(`BEGIN failed: ${String(err)}`);
    }
    try {
      body();
      this.db.exec('COMMIT');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (
        err instanceof PersonaNotFoundError ||
        err instanceof PersonaPrincipalConflictError ||
        err instanceof PersonaPrincipalDeletionError ||
        err instanceof AliasNotFoundError ||
        err instanceof AliasDuplicateError ||
        err instanceof PersonaInvalidParamsError
      ) {
        throw err;
      }
      if (isForeignKeyError(err)) {
        throw new PersonaReferencedError(referencedPersonaId ?? 'unknown');
      }
      throw new PersonaStoreUnavailableError(`Persona store write failed: ${String(err)}`);
    }
  }
}

function isAliasKind(v: unknown): v is AliasKind {
  return typeof v === 'string' && (ALIAS_KINDS_V1 as readonly string[]).includes(v);
}

function validateAliasInput(a: AliasInput): void {
  const text = a.aliasText.trim();
  if (!text) {
    throw new PersonaInvalidParamsError('aliasText must be non-empty');
  }
  if (!isAliasKind(a.aliasKind)) {
    throw new PersonaInvalidParamsError(`Invalid aliasKind: ${String(a.aliasKind)}`);
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed');
}

function isForeignKeyError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('FOREIGN KEY constraint failed');
}
