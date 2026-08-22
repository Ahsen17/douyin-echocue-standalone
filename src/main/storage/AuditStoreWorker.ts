import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  TRACE_TRANSITIONS_V1,
  TraceFinalStateSchema,
} from '@echocue/contracts';
import type {
  TraceState,
  TraceReasonCodeV1,
  AuditSnapshotRoleV1,
  AuditContentTypeV1,
} from '@echocue/contracts';
import { FieldEncryptor, buildAad } from '../crypto/field-encryptor.js';
import { CryptoKeyManager } from '../crypto/key-manager.js';
import type { MigrationFile } from './MigrationRunner.js';
import { MigrationRunner } from './MigrationRunner.js';

export interface AuditStoreWorkerOptions {
  dbPath: string;
  migrations: MigrationFile[];
  keyManager: CryptoKeyManager;
  keyVersion: string;
}

export interface CreateSessionParams {
  sessionId: string;
  roomReference: string;
  platformRoomId?: string;
  startedAt: string;
  safetyPolicyVersion?: string;
  providerId?: string;
  adapterType?: string;
  modelId?: string;
}

export interface CreateTraceParams {
  traceId: string;
  sessionId: string;
  sourceMessageId: string;
  receivedAt: string;
}

export interface AppendSnapshotInput {
  snapshotId: string;
  contentType: AuditContentTypeV1;
  role: AuditSnapshotRoleV1;
  plaintext: Buffer;
}

/** A decrypted audit snapshot, re-linked to its transition (M5-09 replay). */
export interface TraceWorkflowSnapshot {
  snapshotId: string;
  role: AuditSnapshotRoleV1;
  contentType: AuditContentTypeV1;
  contentHmac: string;
  plaintext: Buffer;
}

export interface TraceWorkflowTransition {
  sequenceNo: number;
  fromState: TraceState | null;
  toState: TraceState;
  reasonCode: TraceReasonCodeV1;
  occurredAt: string;
  snapshots: TraceWorkflowSnapshot[];
}

/** Replayable trace workflow: transitions in order, each with decrypted snapshots. */
export interface TraceWorkflow {
  traceId: string;
  transitions: TraceWorkflowTransition[];
}

export class AuditStateInvalidError extends Error {
  readonly code = 'E_AUDIT_STATE_INVALID';
  constructor(msg: string) {
    super(msg);
    this.name = 'AuditStateInvalidError';
  }
}

export class AuditUnavailableError extends Error {
  readonly code = 'E_AUDIT_UNAVAILABLE';
  constructor(msg: string) {
    super(msg);
    this.name = 'AuditUnavailableError';
  }
}

const FINAL_STATES = new Set(TraceFinalStateSchema.options);

export class AuditStoreWorker {
  private readonly db: DatabaseSync;
  private readonly encryptor: FieldEncryptor;

  constructor(private readonly options: AuditStoreWorkerOptions) {
    const runner = new MigrationRunner(options.dbPath, options.migrations);
    try {
      this.db = runner.run();
    } catch (err) {
      throw new AuditUnavailableError(`Failed to open audit DB: ${String(err)}`);
    }
    const dek = options.keyManager.getDek(options.keyVersion);
    this.encryptor = new FieldEncryptor(dek, options.keyVersion);
  }

  close(): void {
    this.db.close();
  }

  healthCheck(): boolean {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      this.db.exec('ROLLBACK');
      return true;
    } catch {
      return false;
    }
  }

  createSession(p: CreateSessionParams): void {
    try {
      this.db.prepare(
        `INSERT INTO live_session
          (session_id, room_reference, platform_room_id, started_at,
           ended_at, end_reason, safety_policy_version, provider_id, adapter_type, model_id)
         VALUES (?,?,?,?,null,null,?,?,?,?)`,
      ).run(
        p.sessionId,
        p.roomReference,
        p.platformRoomId ?? null,
        p.startedAt,
        p.safetyPolicyVersion ?? null,
        p.providerId ?? null,
        p.adapterType ?? null,
        p.modelId ?? null,
      );
    } catch (err) {
      throw new AuditUnavailableError(`createSession failed: ${String(err)}`);
    }
  }

  createTrace(p: CreateTraceParams): void {
    try {
      this.db.prepare(
        `INSERT INTO audit_trace
          (trace_id, session_id, source_message_id, received_at,
           final_state, label_status, current_feedback_id, created_at, completed_at)
         VALUES (?,?,?,?,null,'UNLABELED',null,?,null)`,
      ).run(p.traceId, p.sessionId, p.sourceMessageId, p.receivedAt, p.receivedAt);
    } catch (err) {
      throw new AuditUnavailableError(`createTrace failed: ${String(err)}`);
    }
  }

  appendTransition(
    traceId: string,
    from: TraceState | null,
    to: TraceState,
    reasonCode: TraceReasonCodeV1,
    snapshots: AppendSnapshotInput[] = [],
  ): void {
    this.validateTransition(from, to);

    try {
      this.db.exec('BEGIN');
    } catch (err) {
      throw new AuditUnavailableError(`BEGIN failed: ${String(err)}`);
    }

    try {
      const row = this.db.prepare(
        `SELECT COALESCE(MAX(sequence_no), 0) as max_seq,
                MAX(CASE WHEN sequence_no = (SELECT MAX(sequence_no) FROM audit_transition WHERE trace_id=?) THEN entry_hmac END) as prev_hmac
         FROM audit_transition WHERE trace_id=?`,
      ).get(traceId, traceId) as { max_seq: number; prev_hmac: string | null };

      const seqNo = row.max_seq + 1;
      const prevHmac = row.prev_hmac ?? null;
      const occurredAt = new Date().toISOString();
      const hmacKey = this.options.keyManager.getHmacKey(this.options.keyVersion);

      const entryHmac = computeTransitionHmac(
        hmacKey,
        traceId,
        seqNo,
        from,
        to,
        reasonCode,
        occurredAt,
        prevHmac,
      );

      this.db.prepare(
        `INSERT INTO audit_transition
          (trace_id, sequence_no, from_state, to_state, reason_code, occurred_at, previous_hmac, entry_hmac)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(traceId, seqNo, from ?? null, to, reasonCode, occurredAt, prevHmac, entryHmac);

      for (const snap of snapshots) {
        const aad = buildAad('audit_snapshot', snap.snapshotId, snap.contentType);
        const envelope = this.encryptor.encrypt(snap.plaintext, aad);
        const contentHmac = computeContentHmac(hmacKey, snap.plaintext);

        this.db.prepare(
          `INSERT INTO audit_snapshot (snapshot_id, content_type, envelope, content_hmac, created_at)
           VALUES (?,?,?,?,?)`,
        ).run(snap.snapshotId, snap.contentType, envelope, contentHmac, occurredAt);

        this.db.prepare(
          `INSERT INTO audit_reference (trace_id, sequence_no, snapshot_id, role)
           VALUES (?,?,?,?)`,
        ).run(traceId, seqNo, snap.snapshotId, snap.role);
      }

      if (FINAL_STATES.has(to as never)) {
        this.db.prepare(
          `UPDATE audit_trace SET final_state=?, completed_at=? WHERE trace_id=?`,
        ).run(to, occurredAt, traceId);
      }

      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      if (err instanceof AuditStateInvalidError) throw err;
      throw new AuditUnavailableError(`appendTransition failed: ${String(err)}`);
    }
  }

  /**
   * Read + decrypt the full workflow of a trace for replay (LLM §7; consumed by
   * M6-09 audit.getWorkflow). Returns null when the trace does not exist.
   * Read-only: an audit failure here never stops the service (M5-07).
   */
  getTraceWorkflow(traceId: string): TraceWorkflow | null {
    try {
      const trace = this.db.prepare('SELECT trace_id FROM audit_trace WHERE trace_id = ?').get(traceId);
      if (trace === undefined) return null;
      const transitions = this.db.prepare(
        `SELECT sequence_no, from_state, to_state, reason_code, occurred_at
         FROM audit_transition WHERE trace_id = ? ORDER BY sequence_no`,
      ).all(traceId) as Array<{
        sequence_no: number;
        from_state: TraceState | null;
        to_state: TraceState;
        reason_code: TraceReasonCodeV1;
        occurred_at: string;
      }>;
      const snapStmt = this.db.prepare(
        `SELECT s.snapshot_id, s.content_type, s.envelope, s.content_hmac, r.role
         FROM audit_reference r JOIN audit_snapshot s ON s.snapshot_id = r.snapshot_id
         WHERE r.trace_id = ? AND r.sequence_no = ?`,
      );
      const workflow: TraceWorkflow = {
        traceId,
        transitions: transitions.map((t) => {
          const rows = snapStmt.all(traceId, t.sequence_no) as Array<{
            snapshot_id: string;
            content_type: AuditContentTypeV1;
            envelope: Uint8Array;
            content_hmac: string;
            role: AuditSnapshotRoleV1;
          }>;
          return {
            sequenceNo: t.sequence_no,
            fromState: t.from_state,
            toState: t.to_state,
            reasonCode: t.reason_code,
            occurredAt: t.occurred_at,
            snapshots: rows.map((s) => ({
              snapshotId: s.snapshot_id,
              role: s.role,
              contentType: s.content_type,
              contentHmac: s.content_hmac,
              plaintext: this.encryptor.decrypt(
                Buffer.from(s.envelope),
                buildAad('audit_snapshot', s.snapshot_id, s.content_type),
              ),
            })),
          };
        }),
      };
      return workflow;
    } catch (err) {
      throw new AuditUnavailableError(`getTraceWorkflow failed: ${String(err)}`);
    }
  }

  private validateTransition(from: TraceState | null, to: TraceState): void {
    const key = from ?? 'INITIAL';
    const allowed = (TRACE_TRANSITIONS_V1 as Record<string, readonly string[]>)[key];
    if (!allowed || !allowed.includes(to)) {
      throw new AuditStateInvalidError(
        `Invalid trace transition: ${from ?? 'INITIAL'} -> ${to}`,
      );
    }
  }
}

function computeTransitionHmac(
  key: Buffer,
  traceId: string,
  seqNo: number,
  from: TraceState | null,
  to: TraceState,
  reasonCode: string,
  occurredAt: string,
  prevHmac: string | null,
): string {
  const payload = JSON.stringify({ traceId, seqNo, from, to, reasonCode, occurredAt, prevHmac });
  return createHmac('sha256', key).update(payload, 'utf-8').digest('hex');
}

function computeContentHmac(key: Buffer, plaintext: Buffer): string {
  return createHmac('sha256', key).update(plaintext).digest('hex');
}
