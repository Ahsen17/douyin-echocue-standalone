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
      result.rearmed = this.rearmEligible(this.batchSize);

      let profile: GoldenProfileParams;
      try {
        const info = await this.qdrantClient.getCollection('golden_set');
        profile = readGoldenProfile(info);
      } catch {
        // Qdrant down or golden_set not bootstrapped: leave PENDING jobs alone so
        // no attempts are burned; a later sweep retries when Qdrant is reachable.
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
            // Permanent data problem: never auto-retry (M7-03).
            this.audit.failSyncJob(job.jobId, job.feedbackId, err.message, true);
          } else {
            // Infrastructure failure: fail this job and stop the batch; the
            // backoff timer re-arms it on a later sweep.
            this.audit.failSyncJob(job.jobId, job.feedbackId, String(err));
            break;
          }
        }
      }
      return result;
    } finally {
      this.inFlight = false;
    }
  }

  private async processOne(job: PendingSyncJob, profile: GoldenProfileParams): Promise<void> {
    const ctx = this.audit.readFeedbackSyncContext(job.feedbackId);
    if (ctx === null) {
      throw new RefluxPayloadError(`feedback context missing for job ${job.jobId}`);
    }
    if (job.action === 'UPSERT') {
      const point = buildUpsertPoint(ctx, profile, this.pipeline, this.now().toISOString());
      await this.qdrantClient.upsert('golden_set', { wait: true, points: [point] });
      this.audit.completeSyncJob(job.jobId, ctx.feedbackId, point.id);
      return;
    }
    if (job.action === 'SET_BAD_CASE') {
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
      return;
    }
    throw new RefluxPayloadError(`unhandled sync action: ${job.action}`);
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

  private backoffMs(attempts: number): number {
    const delay = this.retryBaseMs * 2 ** Math.max(0, attempts - 1);
    return Math.min(delay, this.retryMaxMs);
  }
}
