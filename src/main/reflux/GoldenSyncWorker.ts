import type { QdrantClient } from '@qdrant/js-client-rest';
import { createBm25TextPipeline } from '../retrieval/index.js';
import type { Bm25TextPipeline } from '../retrieval/index.js';
import type { GoldenProfileParams } from '../retrieval/index.js';
import type { AuditStoreWorker, PendingSyncJob } from '../storage/index.js';
import {
  RefluxPayloadError,
  buildUpsertPoint,
  readGoldenProfile,
} from './payload-builder.js';
import type { GoldenSyncProcessResult, GoldenSyncWorkerOptions } from './types.js';

const DEFAULT_RETRY_BASE_MS = 5_000;
const DEFAULT_RETRY_MAX_MS = 300_000;
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 20;

/**
 * Transactional outbox consumer (DATA §4.3): drains qdrant_sync_job PENDING
 * jobs into the active golden_set collection. The audit worker owns SQLite; this
 * worker only reads contexts through it and writes Qdrant, then marks jobs
 * SUCCEEDED/FAILED. Jobs stay PENDING (never burning attempts) while Qdrant is
 * unreachable; genuine Qdrant failures go FAILED and are re-armed with
 * exponential backoff. Runs in the main process (M7-02 UPSERT, M7-03 bad-case).
 */
export class GoldenSyncWorker {
  private readonly audit: AuditStoreWorker;
  private readonly qdrantClient: QdrantClient;
  private readonly pipeline: Bm25TextPipeline;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly maxAttempts: number;
  private readonly sweepIntervalMs: number;
  private readonly batchSize: number;
  private readonly now: () => Date;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(options: GoldenSyncWorkerOptions) {
    this.audit = options.audit;
    this.qdrantClient = options.qdrantClient;
    this.pipeline = options.pipeline ?? createBm25TextPipeline();
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.retryMaxMs = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.now = options.now ?? (() => new Date());
  }

  /** Start the sweep timer; also recover RUNNING jobs left by a crashed process. */
  start(): void {
    this.audit.resetStaleRunningJobs();
    if (this.timer === null) {
      this.timer = setInterval(() => {
        void this.processPending();
      }, this.sweepIntervalMs);
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One sweep: re-arm elapsed FAILED jobs, then claim and process up to
   * batchSize PENDING jobs. Re-entrancy is guarded so overlapping sweeps (timer
   * + post-label trigger) never double-claim.
   */
  async processPending(): Promise<GoldenSyncProcessResult> {
    if (this.inFlight) return { rearmed: 0, claimed: 0, succeeded: 0, failed: 0 };
    this.inFlight = true;
    const result: GoldenSyncProcessResult = { rearmed: 0, claimed: 0, succeeded: 0, failed: 0 };
    try {
      try {
        result.rearmed = this.rearmEligible(this.batchSize);

        let info: Parameters<typeof readGoldenProfile>[0];
        try {
          info = await this.qdrantClient.getCollection('golden_set');
        } catch {
          // Qdrant down or golden_set not bootstrapped: a transient outage. Leave
          // PENDING jobs alone so no attempts are burned; a later sweep retries.
          return result;
        }

        let profile: GoldenProfileParams;
        try {
          profile = readGoldenProfile(info);
        } catch (err) {
          // golden_set exists but its BM25 metadata is missing/invalid — a
          // persistent config error, not a transient outage. UPSERT jobs cannot
          // proceed without the profile, so they are permanently failed
          // (observable) instead of silently idling. SET_BAD_CASE does not need
          // the profile and is processed normally.
          const message = err instanceof RefluxPayloadError
            ? err.message
            : 'golden_set profile unavailable';
          for (let i = 0; i < this.batchSize; i++) {
            const job = this.audit.claimNextSyncJob();
            if (job === null) break;
            result.claimed += 1;
            if (job.action === 'SET_BAD_CASE') {
              try {
                await this.processBadCase(job);
                result.succeeded += 1;
              } catch (badCaseErr) {
                result.failed += 1;
                if (badCaseErr instanceof RefluxPayloadError) {
                  this.audit.failSyncJob(job.jobId, job.feedbackId, badCaseErr.message, true);
                } else {
                  this.audit.failSyncJob(
                    job.jobId,
                    job.feedbackId,
                    badCaseErr instanceof Error ? badCaseErr.name : 'UnknownSyncError',
                  );
                }
              }
              continue;
            }
            this.audit.failSyncJob(job.jobId, job.feedbackId, message, true);
            result.failed += 1;
          }
          return result;
        }

        for (let i = 0; i < this.batchSize; i++) {
          const job = this.audit.claimNextSyncJob();
          if (job === null) break;
          result.claimed += 1;
          try {
            await this.processOne(job, profile);
            result.succeeded += 1;
          } catch (err) {
            result.failed += 1;
            if (err instanceof RefluxPayloadError) {
              // Permanent data problem: never auto-retry (M7-03). The message is a
              // fixed internal string, safe to persist.
              this.audit.failSyncJob(job.jobId, job.feedbackId, err.message, true);
            } else {
              // Infrastructure failure: fail this job and stop the batch; the
              // backoff timer re-arms it on a later sweep. A Qdrant error may echo
              // the golden request body (reply/comment text), so only the error
              // class is persisted — never the raw message (安全红线).
              const safe = err instanceof Error ? err.name : 'UnknownSyncError';
              this.audit.failSyncJob(job.jobId, job.feedbackId, safe);
              break;
            }
          }
        }
        return result;
      } catch {
        // Defensive: a storage/Qdrant hiccup outside the per-job handlers must
        // never surface as an unhandled rejection to fire-and-forget callers
        // (sweep timer, onLabelSubmitted).
        return result;
      }
    } finally {
      this.inFlight = false;
    }
  }

  private async processOne(job: PendingSyncJob, profile: GoldenProfileParams): Promise<void> {
    if (job.action === 'UPSERT') {
      const ctx = this.audit.readFeedbackSyncContext(job.feedbackId);
      if (ctx === null) {
        throw new RefluxPayloadError(`feedback context missing for job ${job.jobId}`);
      }
      const point = buildUpsertPoint(ctx, profile, this.pipeline, this.now().toISOString());
      await this.qdrantClient.upsert('golden_set', { wait: true, points: [point] });
      this.audit.completeSyncJob(job.jobId, ctx.feedbackId, point.id);
      return;
    }
    if (job.action === 'SET_BAD_CASE') {
      await this.processBadCase(job);
      return;
    }
    throw new RefluxPayloadError(`unhandled sync action: ${job.action}`);
  }

  private async processBadCase(job: PendingSyncJob): Promise<void> {
    const ctx = this.audit.readFeedbackSyncContext(job.feedbackId);
    if (ctx === null) {
      throw new RefluxPayloadError(`feedback context missing for job ${job.jobId}`);
    }
    // CONTRACT §4.3: only the golden direct source point is marked bad; the
    // migration trigger already rejected anything else at insert time.
    if (ctx.source.collection !== 'golden_set' || ctx.source.pointId === null) {
      throw new RefluxPayloadError(`SET_BAD_CASE job has no golden direct source: ${job.jobId}`);
    }
    await this.qdrantClient.setPayload('golden_set', {
      wait: true,
      payload: { is_bad_case: true, updated_at: this.now().toISOString() },
      points: [ctx.source.pointId],
    });
    this.audit.completeSyncJob(job.jobId, ctx.feedbackId, ctx.source.pointId);
  }

  private rearmEligible(limit: number): number {
    const nowMs = this.now().getTime();
    const failed = this.audit.listFailedSyncJobs(limit);
    const eligible = failed.filter(
      (job) => job.attempts < this.maxAttempts && nowMs >= new Date(job.updatedAt).getTime() + this.backoffMs(job.attempts),
    );
    if (eligible.length === 0) return 0;
    return this.audit.rearmEligibleSyncJobs(eligible.map((job) => job.jobId));
  }

  // Exponential backoff is only expressive above the sweep interval: a delay
  // shorter than one sweep simply retries on the next sweep (effective cadence
  // ≈ sweepIntervalMs). Delays above the interval are honored.
  private backoffMs(attempts: number): number {
    const delay = this.retryBaseMs * 2 ** Math.max(0, attempts - 1);
    return Math.min(delay, this.retryMaxMs);
  }
}
