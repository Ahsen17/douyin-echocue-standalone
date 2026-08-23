import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuditWorkflowV1 } from '@echocue/contracts';
import { GoldenSyncWorker } from '../../../src/main/reflux/index.js';
import type { FeedbackSyncContext } from '../../../src/main/storage/index.js';
import { uuidv7 } from '../../../src/main/util/uuidv7.js';

const NOW = new Date('2026-08-23T00:00:00.000Z');
const PROFILE_METADATA = { config: { metadata: { bm25_k1: 1.2, bm25_b: 0.75, avg_doc_len_baseline: 4 } } };

function validCtx(overrides: Partial<FeedbackSyncContext> = {}): FeedbackSyncContext {
  const workflow: AuditWorkflowV1 = {
    traceId: uuidv7(),
    transitions: [{
      sequenceNo: 1,
      fromState: 'RECEIVED',
      toState: 'NORMALIZED',
      reasonCode: 'NORMALIZATION_OK',
      occurredAt: NOW.toISOString(),
      snapshots: [
        { snapshotId: uuidv7(), role: 'NORMALIZED_COMMENT', contentType: 'NORMALIZED_COMMENT_JSON', plaintext: JSON.stringify({ normalizedText: '主播晚上好' }) },
        { snapshotId: uuidv7(), role: 'RERANK_DECISION', contentType: 'DECISION_JSON', plaintext: JSON.stringify({ mergedTopK: [{ payload: { semantic_type: 'positive_praise' } }] }) },
        { snapshotId: uuidv7(), role: 'DIRECT_PAYLOAD', contentType: 'SUGGESTION_JSON', plaintext: JSON.stringify({ quick_reply: '谢谢你', cues: ['接住夸奖', '邀请互动'] }) },
      ],
    }],
  };
  return {
    feedbackId: uuidv7(),
    traceId: workflow.traceId,
    revisionNo: 1,
    personaId: 'p-1',
    personaVersion: uuidv7(),
    qualityScore: 90,
    labelStatus: 'ACCEPTED',
    correction: null,
    source: { collection: null, pointId: null },
    workflow,
    ...overrides,
  };
}

function makeWorker(overrides: Record<string, unknown> = {}) {
  const audit = {
    resetStaleRunningJobs: vi.fn(() => 0),
    listFailedSyncJobs: vi.fn(() => []),
    rearmEligibleSyncJobs: vi.fn(() => 0),
    claimNextSyncJob: vi.fn(() => null),
    readFeedbackSyncContext: vi.fn(),
    completeSyncJob: vi.fn(),
    failSyncJob: vi.fn(),
  };
  const qdrantClient = {
    getCollection: vi.fn(),
    upsert: vi.fn(),
    setPayload: vi.fn(),
  };
  const worker = new GoldenSyncWorker({
    audit: audit as never,
    qdrantClient: qdrantClient as never,
    // Reads the fake system clock set by vi.setSystemTime so backoff timing is testable.
    now: () => new Date(),
    ...overrides,
  });
  return { worker, audit, qdrantClient };
}

describe('GoldenSyncWorker.processPending (M7-02/03)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves PENDING jobs untouched when Qdrant is unreachable (no attempts burned)', async () => {
    const { worker, audit, qdrantClient } = makeWorker();
    qdrantClient.getCollection.mockRejectedValue(new Error('connection refused'));

    const result = await worker.processPending();
    expect(result).toEqual({ rearmed: 0, claimed: 0, succeeded: 0, failed: 0 });
    expect(audit.claimNextSyncJob).not.toHaveBeenCalled();
    expect(audit.failSyncJob).not.toHaveBeenCalled();
  });

  it('re-arms only FAILED jobs whose backoff has elapsed', async () => {
    const { worker, audit, qdrantClient } = makeWorker();
    const failed = [{ jobId: 'job-1', feedbackId: 'fb-1', action: 'UPSERT', attempts: 1, updatedAt: NOW.toISOString() }];
    audit.listFailedSyncJobs.mockReturnValue(failed);
    qdrantClient.getCollection.mockResolvedValue(PROFILE_METADATA);

    // 3s later: retryBaseMs=5000, so not yet eligible.
    vi.setSystemTime(new Date(NOW.getTime() + 3_000));
    await worker.processPending();
    expect(audit.rearmEligibleSyncJobs).not.toHaveBeenCalled();

    // 6s later: backoff elapsed → re-armed.
    vi.setSystemTime(new Date(NOW.getTime() + 6_000));
    await worker.processPending();
    expect(audit.rearmEligibleSyncJobs).toHaveBeenCalledWith(['job-1']);
  });

  it('never re-arms a job at maxAttempts', async () => {
    const { worker, audit, qdrantClient } = makeWorker({ maxAttempts: 3 });
    audit.listFailedSyncJobs.mockReturnValue([
      { jobId: 'job-1', feedbackId: 'fb-1', action: 'UPSERT', attempts: 3, updatedAt: NOW.toISOString() },
    ]);
    qdrantClient.getCollection.mockResolvedValue(PROFILE_METADATA);
    vi.setSystemTime(new Date(NOW.getTime() + 3_600_000));

    await worker.processPending();
    expect(audit.rearmEligibleSyncJobs).not.toHaveBeenCalled();
  });

  it('upserts an accepted label into golden_set and completes the job', async () => {
    const { worker, audit, qdrantClient } = makeWorker();
    const ctx = validCtx();
    audit.claimNextSyncJob
      .mockReturnValueOnce({ jobId: 'job-1', feedbackId: ctx.feedbackId, action: 'UPSERT' })
      .mockReturnValueOnce(null);
    audit.readFeedbackSyncContext.mockReturnValue(ctx);
    qdrantClient.getCollection.mockResolvedValue(PROFILE_METADATA);
    qdrantClient.upsert.mockResolvedValue({ status: 'ok' });

    const result = await worker.processPending();
    expect(result.claimed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(qdrantClient.upsert).toHaveBeenCalledWith('golden_set', expect.objectContaining({ wait: true }));
    const point = qdrantClient.upsert.mock.calls[0][1].points[0];
    expect(point.payload.reply).toBe('谢谢你');
    expect(audit.completeSyncJob).toHaveBeenCalledWith('job-1', ctx.feedbackId, point.id);
  });

  it('marks a Qdrant upsert failure FAILED and stops the batch', async () => {
    const { worker, audit, qdrantClient } = makeWorker();
    const ctx = validCtx();
    audit.claimNextSyncJob.mockReturnValueOnce({ jobId: 'job-1', feedbackId: ctx.feedbackId, action: 'UPSERT' });
    audit.readFeedbackSyncContext.mockReturnValue(ctx);
    qdrantClient.getCollection.mockResolvedValue(PROFILE_METADATA);
    qdrantClient.upsert.mockRejectedValue(new Error('qdrant 503'));

    const result = await worker.processPending();
    expect(result.failed).toBe(1);
    // Only the error class is persisted; a Qdrant error must not echo the golden payload.
    expect(audit.failSyncJob).toHaveBeenCalledWith('job-1', ctx.feedbackId, 'Error');
    expect(audit.failSyncJob.mock.calls[0][3]).not.toBe(true); // not permanent
  });

  it('permanently fails a job with missing feedback context (RefluxPayloadError)', async () => {
    const { worker, audit, qdrantClient } = makeWorker();
    audit.claimNextSyncJob.mockReturnValueOnce({ jobId: 'job-1', feedbackId: 'missing', action: 'UPSERT' });
    audit.readFeedbackSyncContext.mockReturnValue(null);
    qdrantClient.getCollection.mockResolvedValue(PROFILE_METADATA);

    const result = await worker.processPending();
    expect(result.failed).toBe(1);
    expect(audit.failSyncJob).toHaveBeenCalledWith('job-1', 'missing', expect.stringContaining('feedback context missing'), true);
  });

  it('marks a rejected golden direct source as bad via setPayload and completes the job (M7-03)', async () => {
    const { worker, audit, qdrantClient } = makeWorker();
    const ctx = validCtx({
      labelStatus: 'REJECTED',
      qualityScore: 0,
      source: { collection: 'golden_set', pointId: 'golden-1' },
    });
    audit.claimNextSyncJob
      .mockReturnValueOnce({ jobId: 'job-1', feedbackId: ctx.feedbackId, action: 'SET_BAD_CASE' })
      .mockReturnValueOnce(null);
    audit.readFeedbackSyncContext.mockReturnValue(ctx);
    qdrantClient.getCollection.mockResolvedValue(PROFILE_METADATA);
    qdrantClient.setPayload.mockResolvedValue({ status: 'ok' });

    const result = await worker.processPending();
    expect(result.claimed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(qdrantClient.setPayload).toHaveBeenCalledWith(
      'golden_set',
      expect.objectContaining({
        payload: expect.objectContaining({ is_bad_case: true }),
        points: ['golden-1'],
      }),
    );
    expect(audit.completeSyncJob).toHaveBeenCalledWith('job-1', ctx.feedbackId, 'golden-1');
    expect(qdrantClient.upsert).not.toHaveBeenCalled();
  });

  it('permanently fails a SET_BAD_CASE job that lost its golden source (M7-03)', async () => {
    const { worker, audit, qdrantClient } = makeWorker();
    const ctx = validCtx({
      labelStatus: 'REJECTED',
      qualityScore: 0,
      source: { collection: null, pointId: null },
    });
    audit.claimNextSyncJob.mockReturnValueOnce({ jobId: 'job-1', feedbackId: ctx.feedbackId, action: 'SET_BAD_CASE' });
    audit.readFeedbackSyncContext.mockReturnValue(ctx);
    qdrantClient.getCollection.mockResolvedValue(PROFILE_METADATA);

    const result = await worker.processPending();
    expect(result.failed).toBe(1);
    expect(audit.failSyncJob).toHaveBeenCalledWith(
      'job-1',
      ctx.feedbackId,
      expect.stringContaining('no golden direct source'),
      true,
    );
  });

  it('guards against overlapping sweeps', async () => {
    const { worker, audit, qdrantClient } = makeWorker();
    let resolveProfile: (value: unknown) => void;
    qdrantClient.getCollection.mockReturnValue(new Promise((resolve) => { resolveProfile = resolve; }));

    const first = worker.processPending();
    const second = await worker.processPending();
    expect(second).toEqual({ rearmed: 0, claimed: 0, succeeded: 0, failed: 0 });
    resolveProfile!(PROFILE_METADATA);
    audit.claimNextSyncJob.mockReturnValue(null);
    await first;
    expect(audit.claimNextSyncJob).toHaveBeenCalled();
  });
});

describe('GoldenSyncWorker.start/stop (M7-02)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('recovers stale RUNNING jobs on start and sweeps on the interval until stop', () => {
    const { worker, audit } = makeWorker({ sweepIntervalMs: 1000 });
    worker.start();
    expect(audit.resetStaleRunningJobs).toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(audit.listFailedSyncJobs).toHaveBeenCalledTimes(1);

    worker.stop();
    vi.advanceTimersByTime(2000);
    expect(audit.listFailedSyncJobs).toHaveBeenCalledTimes(1);
  });
});
