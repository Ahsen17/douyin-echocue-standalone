import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SettingsStore } from '../config/SettingsStore.js';
import { FieldEncryptor, buildAad } from '../crypto/field-encryptor.js';
import type { CryptoKeyManager } from '../crypto/key-manager.js';
import type { MigrationFile } from '../storage/MigrationRunner.js';
import { MigrationRunner } from '../storage/MigrationRunner.js';
import { UUID_V7_PATTERN, uuidv7 } from '../util/uuidv7.js';
import { SAFETY_COMPILER_VERSION, compilePolicy } from './SafetyRuleCompiler.js';
import type {
  CompiledSafetyRuleV1,
  CompileErrorV1,
  CreatePolicyDraftParams,
  PolicyContent,
  SafetyPolicyStatus,
  SafetyPolicyVersionMeta,
} from './types.js';

export interface SafetyPolicyStoreOptions {
  dbPath: string;
  migrations: MigrationFile[];
  keyManager: CryptoKeyManager;
  keyVersion: string;
  settingsStore: SettingsStore;
}

export class SafetyPolicyUnavailableError extends Error {
  readonly code = 'E_SAFETY_POLICY_UNAVAILABLE';
  constructor(msg: string) {
    super(msg);
    this.name = 'SafetyPolicyUnavailableError';
  }
}

export class SafetyPolicyNotFoundError extends Error {
  readonly code = 'E_SAFETY_POLICY_NOT_FOUND';
  constructor(versionId: string) {
    super(`Safety policy version not found: ${versionId}`);
    this.name = 'SafetyPolicyNotFoundError';
  }
}

export class SafetyPolicyInvalidError extends Error {
  readonly code = 'E_SAFETY_POLICY_INVALID';
  constructor(msg: string) {
    super(msg);
    this.name = 'SafetyPolicyInvalidError';
  }
}

export class SafetyPolicyImmutableError extends Error {
  readonly code = 'E_SAFETY_POLICY_IMMUTABLE';
  constructor(msg: string) {
    super(msg);
    this.name = 'SafetyPolicyImmutableError';
  }
}

export class SafetyPolicyInvalidParamsError extends Error {
  readonly code = 'E_SAFETY_POLICY_INVALID_PARAMS';
  constructor(msg: string) {
    super(msg);
    this.name = 'SafetyPolicyInvalidParamsError';
  }
}

export class SafetyPolicyContentDecryptionError extends Error {
  readonly code = 'E_SAFETY_POLICY_DECRYPTION_FAILED';
  constructor(msg: string) {
    super(msg);
    this.name = 'SafetyPolicyContentDecryptionError';
  }
}

interface SafetyPolicyMetaRow {
  safety_policy_version: string;
  status: string;
  compiler_version: string;
  created_at: string;
  published_at: string | null;
}

interface SafetyPolicyRow extends SafetyPolicyMetaRow {
  policy_text_envelope: Buffer;
  keywords_envelope: Buffer;
  compiled_rules_envelope: Buffer | null;
  validation_error_envelope: Buffer | null;
}

const ENVELOPE_COLUMNS = {
  policyText: 'policy_text',
  keywords: 'keywords',
  compiledRules: 'compiled_rules',
  validationError: 'validation_error',
} as const;

export class SafetyPolicyStore {
  private readonly db: DatabaseSync;
  private readonly encryptor: FieldEncryptor;

  constructor(private readonly options: SafetyPolicyStoreOptions) {
    const runner = new MigrationRunner(options.dbPath, options.migrations);
    try {
      this.db = runner.run();
    } catch (err) {
      throw new SafetyPolicyUnavailableError(`Failed to open audit DB: ${String(err)}`);
    }
    const dek = options.keyManager.getDek(options.keyVersion);
    this.encryptor = new FieldEncryptor(dek, options.keyVersion);
  }

  close(): void {
    this.db.close();
  }

  createDraft(input: CreatePolicyDraftParams): SafetyPolicyVersionMeta {
    const result = compilePolicy({
      compilerVersion: SAFETY_COMPILER_VERSION,
      policyText: input.policyText,
      keywords: input.keywords ?? [],
    });
    const versionId = uuidv7();
    const now = new Date().toISOString();
    const status: SafetyPolicyStatus = result.valid ? 'DRAFT' : 'INVALID';
    const compiledEnvelope = result.valid
      ? this.encryptColumn(versionId, ENVELOPE_COLUMNS.compiledRules, JSON.stringify(result.compiledRules))
      : null;
    const validationErrorEnvelope = result.valid
      ? null
      : this.encryptColumn(versionId, ENVELOPE_COLUMNS.validationError, JSON.stringify(result.errors));

    const args: SQLInputValue[] = [
      versionId,
      status,
      this.encryptColumn(versionId, ENVELOPE_COLUMNS.policyText, input.policyText),
      this.encryptColumn(versionId, ENVELOPE_COLUMNS.keywords, JSON.stringify(input.keywords ?? [])),
      compiledEnvelope,
      SAFETY_COMPILER_VERSION,
      validationErrorEnvelope,
      now,
      null,
    ];
    try {
      this.db
        .prepare(
          `INSERT INTO safety_policy_version
             (safety_policy_version, status, policy_text_envelope, keywords_envelope,
              compiled_rules_envelope, compiler_version, validation_error_envelope, created_at, published_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(...args);
    } catch (err) {
      throw new SafetyPolicyUnavailableError(`createDraft failed: ${String(err)}`);
    }
    return this.mapMetaRow({
      safety_policy_version: versionId,
      status,
      compiler_version: SAFETY_COMPILER_VERSION,
      created_at: now,
      published_at: null,
    });
  }

  publishDraft(versionId: string): void {
    const row = this.getVersionRow(versionId);
    if (row.status === 'INVALID') {
      throw new SafetyPolicyInvalidError(`Cannot publish an INVALID safety policy version: ${versionId}`);
    }
    if (row.status !== 'DRAFT') {
      throw new SafetyPolicyImmutableError(`Only DRAFT versions can be published: ${versionId}`);
    }
    const now = new Date().toISOString();
    this.runTransaction(() => {
      this.db
        .prepare(`UPDATE safety_policy_version SET status = 'PUBLISHED', published_at = ? WHERE safety_policy_version = ?`)
        .run(now, versionId);
      this.db
        .prepare(`UPDATE safety_policy_version SET status = 'SUPERSEDED' WHERE status = 'PUBLISHED' AND safety_policy_version <> ?`)
        .run(versionId);
    });
  }

  async activatePublishedVersion(versionId: string): Promise<void> {
    if (!UUID_V7_PATTERN.test(versionId)) {
      throw new SafetyPolicyInvalidParamsError('active safety policy version must be a UUIDv7');
    }
    const row = this.getVersionRow(versionId);
    if (row.status !== 'PUBLISHED') {
      throw new SafetyPolicyInvalidParamsError('Only PUBLISHED safety policy versions can be activated');
    }
    await this.options.settingsStore.update({ activeSafetyPolicyVersion: versionId });
  }

  // Fail closed: an unset or stale settings pointer yields null, never a
  // rule-less runtime; the runtime refuses to start without an active version.
  async getActivePublishedVersion(): Promise<string | null> {
    const settings = await this.options.settingsStore.get();
    const versionId = settings?.activeSafetyPolicyVersion ?? null;
    if (versionId === null) {
      return null;
    }
    let meta: SafetyPolicyVersionMeta;
    try {
      meta = this.getVersionMeta(versionId);
    } catch {
      return null;
    }
    return meta.status === 'PUBLISHED' ? versionId : null;
  }

  readPolicy(versionId: string): PolicyContent {
    const row = this.getVersionRow(versionId, true);
    const policyText = this.decryptColumn(row.policy_text_envelope, versionId, ENVELOPE_COLUMNS.policyText);
    const keywords = JSON.parse(
      this.decryptColumn(row.keywords_envelope, versionId, ENVELOPE_COLUMNS.keywords),
    ) as string[];
    let compiledRules: CompiledSafetyRuleV1[] | null = null;
    if (row.compiled_rules_envelope !== null) {
      compiledRules = JSON.parse(
        this.decryptColumn(row.compiled_rules_envelope, versionId, ENVELOPE_COLUMNS.compiledRules),
      ) as CompiledSafetyRuleV1[];
    }
    let validationErrors: CompileErrorV1[] | null = null;
    if (row.validation_error_envelope !== null) {
      validationErrors = JSON.parse(
        this.decryptColumn(row.validation_error_envelope, versionId, ENVELOPE_COLUMNS.validationError),
      ) as CompileErrorV1[];
    }
    return { policyText, keywords, compiledRules, validationErrors };
  }

  getVersionMeta(versionId: string): SafetyPolicyVersionMeta {
    return this.mapMetaRow(this.getVersionRow(versionId));
  }

  listVersions(): SafetyPolicyVersionMeta[] {
    const rows = this.db
      .prepare(
        `SELECT safety_policy_version, status, compiler_version, created_at, published_at
         FROM safety_policy_version ORDER BY created_at ASC`,
      )
      .all() as unknown as SafetyPolicyMetaRow[];
    return rows.map((r) => this.mapMetaRow(r));
  }

  private getVersionRow(versionId: string, includeEnvelope = false): SafetyPolicyRow {
    // Metadata reads (getVersionMeta/listVersions) must not touch encrypted columns.
    const columns = includeEnvelope
      ? `safety_policy_version, status, compiler_version, created_at, published_at,
         policy_text_envelope, keywords_envelope, compiled_rules_envelope, validation_error_envelope`
      : `safety_policy_version, status, compiler_version, created_at, published_at`;
    const row = this.db
      .prepare(`SELECT ${columns} FROM safety_policy_version WHERE safety_policy_version = ?`)
      .get(versionId) as SafetyPolicyRow | undefined;
    if (!row) {
      throw new SafetyPolicyNotFoundError(versionId);
    }
    if (includeEnvelope) {
      // node:sqlite hands BLOBs back as plain Uint8Array whose .toString() is not utf-8.
      row.policy_text_envelope = Buffer.from(row.policy_text_envelope);
      row.keywords_envelope = Buffer.from(row.keywords_envelope);
      if (row.compiled_rules_envelope !== null) {
        row.compiled_rules_envelope = Buffer.from(row.compiled_rules_envelope);
      }
      if (row.validation_error_envelope !== null) {
        row.validation_error_envelope = Buffer.from(row.validation_error_envelope);
      }
    }
    return row;
  }

  private encryptColumn(versionId: string, column: string, value: string): Buffer {
    return this.encryptor.encrypt(
      Buffer.from(value, 'utf-8'),
      buildAad('safety_policy_version', versionId, column),
    );
  }

  private decryptColumn(envelope: Buffer, versionId: string, column: string): string {
    try {
      return this.encryptor
        .decrypt(envelope, buildAad('safety_policy_version', versionId, column))
        .toString('utf-8');
    } catch (err) {
      throw new SafetyPolicyContentDecryptionError(`Failed to decrypt safety policy content: ${String(err)}`);
    }
  }

  private mapMetaRow(r: SafetyPolicyMetaRow): SafetyPolicyVersionMeta {
    return {
      safetyPolicyVersion: r.safety_policy_version,
      status: r.status as SafetyPolicyStatus,
      compilerVersion: r.compiler_version,
      createdAt: r.created_at,
      publishedAt: r.published_at,
    };
  }

  private runTransaction(body: () => void): void {
    try {
      this.db.exec('BEGIN');
    } catch (err) {
      throw new SafetyPolicyUnavailableError(`BEGIN failed: ${String(err)}`);
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
        err instanceof SafetyPolicyNotFoundError ||
        err instanceof SafetyPolicyInvalidError ||
        err instanceof SafetyPolicyImmutableError ||
        err instanceof SafetyPolicyInvalidParamsError ||
        err instanceof SafetyPolicyContentDecryptionError
      ) {
        throw err;
      }
      throw new SafetyPolicyUnavailableError(`Safety policy store write failed: ${String(err)}`);
    }
  }
}
