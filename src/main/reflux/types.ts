import type { QdrantClient } from '@qdrant/js-client-rest';
import type { AuditStoreWorker } from '../storage/index.js';
import type { Bm25TextPipeline } from '../retrieval/index.js';

/** Outcome of one processPending sweep (M7-02/03). */
export interface GoldenSyncProcessResult {
  /** FAILED jobs whose backoff elapsed and were re-armed to PENDING. */
  rearmed: number;
  /** Jobs claimed and processed this sweep. */
  claimed: number;
  succeeded: number;
  failed: number;
}

export interface GoldenSyncWorkerOptions {
  audit: AuditStoreWorker;
  qdrantClient: QdrantClient;
  pipeline?: Bm25TextPipeline;
  /** Exponential backoff base for FAILED→PENDING re-arm (default 5s). */
  retryBaseMs?: number;
  /** Backoff cap (default 5min). */
  retryMaxMs?: number;
  /** Stop auto-retry after this many attempts (default 8). */
  maxAttempts?: number;
  /** Sweep timer interval (default 60s). */
  sweepIntervalMs?: number;
  /** Max jobs processed per sweep (default 20). */
  batchSize?: number;
  /** Injectable clock for backoff tests. */
  now?: () => Date;
}
