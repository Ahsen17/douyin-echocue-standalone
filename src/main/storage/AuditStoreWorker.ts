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
  AuditSearchRequestV1,
  AuditSearchResponseV1,
  AuditTraceSummaryV1,
  AuditWorkflowV1,
  AuditSubmitLabelRequestV1,
  LabelStatus,
  TraceFinalState,
  OutboxActionV1,
} from '@echocue/contracts';
import { FieldEncryptor, buildAad } from '../crypto/field-encryptor.js';
import { CryptoKeyManager } from '../crypto/key-manager.js';
import { uuidv7 } from '../util/uuidv7.js';
import type { MigrationFile } from './MigrationRunner.js';
import { MigrationRunner } from './MigrationRunner.js';
import { RefluxPayloadError, deriveRefluxAction } from '../reflux/payload-builder.js';

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

// qdrant_sync_job I/O contract (M7-01). These types stay in the storage layer
// because the job lifecycle methods below are AuditStoreWorker's own surface;
// the reflux worker consumes them via ../storage/index.js.

/** A qdrant_sync_job row in PENDING state, eligible for claim. */
export interface PendingSyncJob {
  jobId: string;
  feedbackId: string;
  action: OutboxActionV1;
}

/** A FAILED job row, used by the worker to decide when backoff has elapsed. */
export interface FailedSyncJob extends PendingSyncJob {
  attempts: number;
  updatedAt: string;
}

/**
 * Decrypted feedback revision + trace workflow that the golden sync worker
 * needs to build a golden_set point (M7-02) or mark a source bad (M7-03).
 * The correction envelope is decrypted here — never in the reflux module.
 */
export interface FeedbackSyncContext {
  feedbackId: string;
  traceId: string;
  revisionNo: number;
  personaId: string;
  personaVersion: string;
  qualityScore: number;
  labelStatus: LabelStatus;
  correction: { correctedQuickReply: string; correctedCues: string[] } | null;
  source: { collection: 'golden_set' | null; pointId: string | null };
  workflow: AuditWorkflowV1;
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

  /**
   * Paginated audit list (CONTRACT §7 / UI §8.2): time range, final result,
   * label status filters, received_at DESC. commentText is decrypted on demand
   * from each row's first NORMALIZED_COMMENT snapshot. Read-only: a failure here
   * never stops the service.
   */
  searchTraces(params: AuditSearchRequestV1): AuditSearchResponseV1 {
    try {
      // Defensive clamp: the IPC schema enforces 1-100, but direct callers must
      // not be able to over-read.
      const pageSize = Math.min(Math.max(params.pageSize, 1), 100);
      const page = Math.max(params.page, 1);
      const where: string[] = [];
      const binds: Array<string | number> = [];
      // received_at is persisted as UTC (toISOString); normalize offset datetimes
      // to UTC so a caller sending +08:00 compares on the same timeline.
      if (params.from !== undefined) {
        where.push('received_at >= ?');
        binds.push(new Date(params.from).toISOString());
      }
      if (params.to !== undefined) {
        where.push('received_at <= ?');
        binds.push(new Date(params.to).toISOString());
      }
      if (params.finalState !== undefined) {
        where.push('final_state = ?');
        binds.push(params.finalState);
      }
      if (params.labelStatus !== undefined) {
        where.push('label_status = ?');
        binds.push(params.labelStatus);
      }
      const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
      const offset = (page - 1) * pageSize;

      const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM audit_trace${whereSql}`)
        .get(...binds) as { total: number };
      const rows = this.db.prepare(
        `SELECT trace_id, received_at, final_state, label_status
         FROM audit_trace${whereSql}
         ORDER BY received_at DESC
         LIMIT ? OFFSET ?`,
      ).all(...binds, pageSize, offset) as Array<{
        trace_id: string;
        received_at: string;
        final_state: TraceFinalState | null;
        label_status: LabelStatus;
      }>;

      const items = rows.map((row) => {
        const commentText = this.readCommentPreview(row.trace_id);
        const hasSuggestion = this.traceHasSuggestion(row.trace_id);
        const revisionCount = this.traceRevisionCount(row.trace_id);
        return {
          traceId: row.trace_id,
          receivedAt: row.received_at,
          finalState: row.final_state,
          labelStatus: row.label_status,
          hasSuggestion,
          commentText,
          revisionCount,
        };
      });
      return { items, total: countRow.total, page, pageSize };
    } catch (err) {
      throw new AuditUnavailableError(`searchTraces failed: ${String(err)}`);
    }
  }

  /** Serializable workflow projection for IPC (Buffer plaintext → utf-8 string). */
  getTraceWorkflowV1(traceId: string): AuditWorkflowV1 | null {
    const workflow = this.getTraceWorkflow(traceId);
    if (workflow === null) return null;
    return {
      traceId: workflow.traceId,
      transitions: workflow.transitions.map((t) => ({
        sequenceNo: t.sequenceNo,
        fromState: t.fromState,
        toState: t.toState,
        reasonCode: t.reasonCode,
        occurredAt: t.occurredAt,
        snapshots: t.snapshots.map((s) => ({
          snapshotId: s.snapshotId,
          role: s.role,
          contentType: s.contentType,
          plaintext: s.plaintext.toString('utf-8'),
        })),
      })),
    };
  }

  /**
   * Persist a label revision (DATA §4.3): write suggestion_feedback
   * (UNIQUE(trace_id, revision_no)), update audit_trace.label_status /
   * current_feedback_id, and when the revision qualifies for reflux write the
   * qdrant_sync_job outbox row — all in ONE transaction. The optimistic lock
   * rejects a concurrent edit (修订而非覆盖); the idempotency key
   * feedbackId:revisionNo:action prevents duplicate jobs. Returns the
   * user-visible labelStatus only; sync_status stays internal (M7-01).
   */
  submitLabel(input: AuditSubmitLabelRequestV1): LabelStatus {
    const workflow = this.getTraceWorkflowV1(input.traceId);
    if (workflow === null) {
      throw new AuditStateInvalidError(`label target trace not found: ${input.traceId}`);
    }
    if (!this.traceHasSuggestion(input.traceId)) {
      throw new AuditStateInvalidError('trace has no final suggestion; no label required');
    }

    const labelStatus = deriveLabelStatus(input);
    const persona = this.readPersonaBinding(workflow);
    const source = this.readDirectSource(workflow);
    // A golden direct point becomes a bad case only when rejected with no
    // correction; the outbox trigger re-validates the same condition.
    const isBadCase = labelStatus === 'REJECTED' && input.correctedQuickReply === undefined && source.pointId !== null;
    const refluxAction = deriveRefluxAction({
      labelStatus,
      score: input.score,
      hasCorrection: input.correctedQuickReply !== undefined,
      source,
    });

    try {
      this.db.exec('BEGIN');
      const countRow = this.db.prepare(
        `SELECT COUNT(*) as revision_count FROM suggestion_feedback WHERE trace_id = ?`,
      ).get(input.traceId) as { revision_count: number };
      if (countRow.revision_count !== input.expectedRevisionNo) {
        this.db.exec('ROLLBACK');
        throw new AuditStateInvalidError('label already changed by another edit; refresh and retry');
      }
      const revisionNo = countRow.revision_count + 1;
      const feedbackId = uuidv7();
      const createdAt = new Date().toISOString();
      const correction = this.buildCorrection(input, feedbackId);
      this.db.prepare(
        `INSERT INTO suggestion_feedback
          (feedback_id, trace_id, revision_no, persona_id, persona_version, quality_score,
           correction_envelope, label_status, sync_status, is_bad_case,
           source_collection, source_point_id, target_point_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,null,?)`,
      ).run(
        feedbackId,
        input.traceId,
        revisionNo,
        persona.personaId,
        persona.personaVersion,
        input.score,
        correction,
        labelStatus,
        refluxAction === null ? 'NOT_REQUIRED' : 'PENDING',
        isBadCase ? 1 : 0,
        source.collection,
        source.pointId,
        createdAt,
      );
      this.db.prepare(
        `UPDATE audit_trace SET label_status = ?, current_feedback_id = ? WHERE trace_id = ?`,
      ).run(labelStatus, feedbackId, input.traceId);
      if (refluxAction !== null) {
        this.db.prepare(
          `INSERT INTO qdrant_sync_job
            (job_id, feedback_id, target_collection, action, idempotency_key,
             state, attempts, last_error, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          uuidv7(),
          feedbackId,
          'golden_set',
          refluxAction,
          `${feedbackId}:${revisionNo}:${refluxAction}`,
          'PENDING',
          0,
          null,
          createdAt,
          createdAt,
        );
      }
      this.db.exec('COMMIT');
      return labelStatus;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      if (err instanceof AuditStateInvalidError) throw err;
      throw new AuditUnavailableError(`submitLabel failed: ${String(err)}`);
    }
  }

  /**
   * Atomically claim one PENDING outbox job (PENDING→RUNNING). BEGIN IMMEDIATE
   * plus `WHERE state='PENDING'` guarantees two callers never claim the same
   * job. Returns null when nothing is pending.
   */
  claimNextSyncJob(): PendingSyncJob | null {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const row = this.db.prepare(
        `SELECT job_id, feedback_id, action FROM qdrant_sync_job
         WHERE state = 'PENDING' ORDER BY created_at LIMIT 1`,
      ).get() as { job_id: string; feedback_id: string; action: OutboxActionV1 } | undefined;
      if (row === undefined) {
        this.db.exec('COMMIT');
        return null;
      }
      this.db.prepare(
        `UPDATE qdrant_sync_job SET state = 'RUNNING', updated_at = ? WHERE job_id = ?`,
      ).run(new Date().toISOString(), row.job_id);
      this.db.exec('COMMIT');
      return { jobId: row.job_id, feedbackId: row.feedback_id, action: row.action };
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw new AuditUnavailableError(`claimNextSyncJob failed: ${String(err)}`);
    }
  }

  /**
   * Re-arm FAILED jobs whose backoff has elapsed (FAILED→PENDING), flipping the
   * feedback sync_status the same way so it stays derived from the job (DATA
   * §4.3). Returns the number of jobs re-armed.
   */
  rearmEligibleSyncJobs(jobIds: readonly string[]): number {
    if (jobIds.length === 0) return 0;
    const now = new Date().toISOString();
    const marks = jobIds.map(() => '?').join(',');
    try {
      this.db.exec('BEGIN');
      const res = this.db.prepare(
        `UPDATE qdrant_sync_job SET state = 'PENDING', updated_at = ? WHERE job_id IN (${marks}) AND state = 'FAILED'`,
      ).run(now, ...jobIds);
      const jobRows = this.db.prepare(
        `SELECT feedback_id FROM qdrant_sync_job WHERE job_id IN (${marks})`,
      ).all(...jobIds) as Array<{ feedback_id: string }>;
      if (jobRows.length > 0) {
        const fbMarks = jobRows.map(() => '?').join(',');
        this.db.prepare(
          `UPDATE suggestion_feedback SET sync_status = 'PENDING'
           WHERE feedback_id IN (${fbMarks}) AND sync_status = 'FAILED'`,
        ).run(...jobRows.map((r) => r.feedback_id));
      }
      this.db.exec('COMMIT');
      return Number(res.changes);
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw new AuditUnavailableError(`rearmEligibleSyncJobs failed: ${String(err)}`);
    }
  }

  /**
   * Decrypted feedback + workflow the worker needs to reflux. Returns null when
   * the feedback row or its trace no longer exists.
   */
  readFeedbackSyncContext(feedbackId: string): FeedbackSyncContext | null {
    try {
      const row = this.db.prepare(
        `SELECT feedback_id, trace_id, revision_no, persona_id, persona_version, quality_score,
                label_status, correction_envelope, source_collection, source_point_id
         FROM suggestion_feedback WHERE feedback_id = ?`,
      ).get(feedbackId) as {
        feedback_id: string;
        trace_id: string;
        revision_no: number;
        persona_id: string;
        persona_version: string;
        quality_score: number;
        label_status: LabelStatus;
        correction_envelope: Uint8Array | null;
        source_collection: 'golden_set' | null;
        source_point_id: string | null;
      } | undefined;
      if (row === undefined) return null;
      const workflow = this.getTraceWorkflowV1(row.trace_id);
      if (workflow === null) return null;
      return {
        feedbackId: row.feedback_id,
        traceId: row.trace_id,
        revisionNo: row.revision_no,
        personaId: row.persona_id,
        personaVersion: row.persona_version,
        qualityScore: row.quality_score,
        labelStatus: row.label_status,
        correction: row.correction_envelope === null
          ? null
          : this.decryptCorrection(row.feedback_id, Buffer.from(row.correction_envelope)),
        source: { collection: row.source_collection, pointId: row.source_point_id },
        workflow,
      };
    } catch (err) {
      // A corrupt correction envelope is a data-integrity problem the reflux
      // worker must see as permanent, not a generic audit failure.
      if (err instanceof RefluxPayloadError) throw err;
      throw new AuditUnavailableError(`readFeedbackSyncContext failed: ${String(err)}`);
    }
  }

  /**
   * Mark a claimed job and its feedback as synced (RUNNING→SUCCEEDED /
   * PENDING→SYNCED) and record the Qdrant point id, in one transaction. The
   * `WHERE state='RUNNING'` guard rejects a double-complete (changes === 0).
   */
  completeSyncJob(jobId: string, feedbackId: string, targetPointId: string): void {
    try {
      this.db.exec('BEGIN');
      const res = this.db.prepare(
        `UPDATE qdrant_sync_job SET state = 'SUCCEEDED', last_error = NULL, updated_at = ?
         WHERE job_id = ? AND state = 'RUNNING'`,
      ).run(new Date().toISOString(), jobId);
      if (res.changes === 0) {
        this.db.exec('ROLLBACK');
        throw new AuditStateInvalidError(`sync job is not RUNNING: ${jobId}`);
      }
      this.db.prepare(
        `UPDATE suggestion_feedback SET sync_status = 'SYNCED', target_point_id = ? WHERE feedback_id = ?`,
      ).run(targetPointId, feedbackId);
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      if (err instanceof AuditStateInvalidError) throw err;
      throw new AuditUnavailableError(`completeSyncJob failed: ${String(err)}`);
    }
  }

  /**
   * Mark a claimed job as failed (RUNNING→FAILED, attempts+1, last_error) and
   * the feedback PENDING→FAILED. A permanent data error caps attempts so the
   * rearm sweep never retries it (M7-03). Permanent failures are terminal for
   * automated retry; recovering them requires manual SQLite/Qdrant intervention
   * (no diagnostic IPC exists in MVP).
   */
  failSyncJob(jobId: string, feedbackId: string, error: string, permanent = false): void {
    try {
      this.db.exec('BEGIN');
      const row = this.db.prepare(
        `SELECT attempts FROM qdrant_sync_job WHERE job_id = ? AND state = 'RUNNING'`,
      ).get(jobId) as { attempts: number } | undefined;
      if (row === undefined) {
        this.db.exec('ROLLBACK');
        throw new AuditStateInvalidError(`sync job is not RUNNING: ${jobId}`);
      }
      const nextAttempts = permanent ? Number.MAX_SAFE_INTEGER : row.attempts + 1;
      this.db.prepare(
        `UPDATE qdrant_sync_job SET state = 'FAILED', attempts = ?, last_error = ?, updated_at = ?
         WHERE job_id = ?`,
      ).run(nextAttempts, error, new Date().toISOString(), jobId);
      this.db.prepare(
        `UPDATE suggestion_feedback SET sync_status = 'FAILED' WHERE feedback_id = ?`,
      ).run(feedbackId);
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      if (err instanceof AuditStateInvalidError) throw err;
      throw new AuditUnavailableError(`failSyncJob failed: ${String(err)}`);
    }
  }

  /** Read-only list of FAILED jobs (oldest first) for backoff computation. */
  listFailedSyncJobs(limit: number): FailedSyncJob[] {
    try {
      const rows = this.db.prepare(
        `SELECT job_id, feedback_id, action, attempts, updated_at
         FROM qdrant_sync_job WHERE state = 'FAILED' ORDER BY updated_at LIMIT ?`,
      ).all(limit) as Array<{
        job_id: string;
        feedback_id: string;
        action: OutboxActionV1;
        attempts: number;
        updated_at: string;
      }>;
      return rows.map((r) => ({
        jobId: r.job_id,
        feedbackId: r.feedback_id,
        action: r.action,
        attempts: r.attempts,
        updatedAt: r.updated_at,
      }));
    } catch (err) {
      throw new AuditUnavailableError(`listFailedSyncJobs failed: ${String(err)}`);
    }
  }

  /**
   * Process-crash recovery on worker startup: any RUNNING job left by a dead
   * process goes back to PENDING (single-writer means nothing is in flight).
   */
  resetStaleRunningJobs(): number {
    try {
      const res = this.db.prepare(
        `UPDATE qdrant_sync_job SET state = 'PENDING', updated_at = ? WHERE state = 'RUNNING'`,
      ).run(new Date().toISOString());
      return Number(res.changes);
    } catch (err) {
      throw new AuditUnavailableError(`resetStaleRunningJobs failed: ${String(err)}`);
    }
  }

  private buildCorrection(input: AuditSubmitLabelRequestV1, feedbackId: string): Uint8Array | null {
    if (input.correctedQuickReply === undefined || input.correctedCues === undefined) return null;
    const plaintext = Buffer.from(JSON.stringify({
      correctedQuickReply: input.correctedQuickReply,
      correctedCues: input.correctedCues,
    }), 'utf-8');
    // AAD is the persisted row primary key (feedback_id) so the envelope stays
    // decryptable by M7-01 reflux — never a throwaway random value.
    const envelope = this.encryptor.encrypt(
      plaintext,
      buildAad('suggestion_feedback', feedbackId, 'CORRECTION_JSON'),
    );
    return Buffer.from(envelope);
  }

  private decryptCorrection(
    feedbackId: string,
    envelope: Buffer,
  ): { correctedQuickReply: string; correctedCues: string[] } {
    // A present envelope that fails to decrypt is a data-integrity problem (e.g.
    // key rotation), not an absent correction — surface it as a permanent error
    // rather than masking it as "no correction".
    let plaintext: Buffer;
    try {
      plaintext = this.encryptor.decrypt(
        envelope,
        buildAad('suggestion_feedback', feedbackId, 'CORRECTION_JSON'),
      );
    } catch {
      throw new RefluxPayloadError('correction envelope failed to decrypt');
    }
    let parsed: { correctedQuickReply?: unknown; correctedCues?: unknown };
    try {
      parsed = JSON.parse(plaintext.toString('utf-8')) as { correctedQuickReply?: unknown; correctedCues?: unknown };
    } catch {
      throw new RefluxPayloadError('correction envelope is not valid JSON');
    }
    if (
      typeof parsed.correctedQuickReply !== 'string' ||
      !Array.isArray(parsed.correctedCues) ||
      !parsed.correctedCues.every((cue) => typeof cue === 'string')
    ) {
      throw new RefluxPayloadError('correction envelope has an unexpected shape');
    }
    return { correctedQuickReply: parsed.correctedQuickReply, correctedCues: parsed.correctedCues };
  }

  private readPersonaBinding(workflow: AuditWorkflowV1): { personaId: string; personaVersion: string } {
    // The PERSONA_VERSION_SNAPSHOT carries the immutable PersonaSnapshot
    // (personaId + personaVersion + content + contentHmac) used for this trace.
    for (const t of workflow.transitions) {
      for (const s of t.snapshots) {
        if (s.role !== 'PERSONA_VERSION_SNAPSHOT') continue;
        const parsed = JSON.parse(s.plaintext) as { personaId?: string; personaVersion?: string };
        if (typeof parsed.personaId === 'string' && typeof parsed.personaVersion === 'string') {
          return { personaId: parsed.personaId, personaVersion: parsed.personaVersion };
        }
      }
    }
    throw new AuditStateInvalidError('trace has no persona binding; cannot label');
  }

  private readDirectSource(workflow: AuditWorkflowV1): {
    collection: 'golden_set' | null;
    pointId: string | null;
  } {
    for (const t of workflow.transitions) {
      for (const s of t.snapshots) {
        if (s.role !== 'DIRECT_DECISION') continue;
        const parsed = JSON.parse(s.plaintext) as { pointId?: string };
        const pointId = typeof parsed.pointId === 'string' ? parsed.pointId : null;
        return { collection: 'golden_set', pointId };
      }
    }
    return { collection: null, pointId: null };
  }

  private readCommentPreview(traceId: string): string {
    try {
      const row = this.db.prepare(
        `SELECT s.snapshot_id, s.content_type, s.envelope
         FROM audit_reference r JOIN audit_snapshot s ON s.snapshot_id = r.snapshot_id
         WHERE r.trace_id = ? AND r.role = 'NORMALIZED_COMMENT'
         ORDER BY r.sequence_no LIMIT 1`,
      ).get(traceId) as { snapshot_id: string; content_type: AuditContentTypeV1; envelope: Uint8Array } | undefined;
      if (row === undefined) return '';
      const plaintext = this.encryptor.decrypt(
        Buffer.from(row.envelope),
        buildAad('audit_snapshot', row.snapshot_id, row.content_type),
      );
      const parsed = JSON.parse(plaintext.toString('utf-8')) as { normalizedText?: unknown };
      if (typeof parsed.normalizedText !== 'string') return '';
      // Comment text can exceed the AuditTraceSummary.commentText cap (2000);
      // truncate so a long 弹幕 never fails the whole page's schema validation.
      return parsed.normalizedText.length > 2000 ? parsed.normalizedText.slice(0, 2000) : parsed.normalizedText;
    } catch {
      // A decrypt/parse failure must not corrupt the whole page; show no preview.
      return '';
    }
  }

  private traceHasSuggestion(traceId: string): boolean {
    try {
      const row = this.db.prepare(
        `SELECT 1 FROM audit_transition
         WHERE trace_id = ? AND to_state IN ('DISPLAYED', 'HIDDEN')
         LIMIT 1`,
      ).get(traceId) as { '1': number } | undefined;
      return row !== undefined;
    } catch {
      return false;
    }
  }

  private traceRevisionCount(traceId: string): number {
    try {
      const row = this.db.prepare(
        `SELECT COUNT(*) as n FROM suggestion_feedback WHERE trace_id = ?`,
      ).get(traceId) as { n: number };
      return row.n;
    } catch {
      return 0;
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

// UI §8.2: 认可（无修正）→ ACCEPTED；不认可无修正 → REJECTED（0 分）；
// 不认可有修正 → CORRECTED。schema 已保证 correctedReply/cues 同现。
function deriveLabelStatus(input: AuditSubmitLabelRequestV1): LabelStatus {
  if (input.correctedQuickReply !== undefined) return 'CORRECTED';
  return input.score === 0 ? 'REJECTED' : 'ACCEPTED';
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
