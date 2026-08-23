import type { LabelStatus, OutboxActionV1 } from '@echocue/contracts';

export interface DeriveRefluxActionInput {
  labelStatus: LabelStatus;
  score: number;
  hasCorrection: boolean;
  source: { collection: 'golden_set' | null; pointId: string | null };
}

/**
 * DATA §4.3 / ARCH §4.3: which qdrant_sync_job action a label revision creates,
 * or null when the revision stays SQLite-only (low-score accept, or a rejection
 * outside the golden direct source). Called inside submitLabel's transaction, so
 * it must be pure and side-effect free.
 */
export function deriveRefluxAction(input: DeriveRefluxActionInput): OutboxActionV1 | null {
  // A corrected answer always refluxes, regardless of the score.
  if (input.hasCorrection) return 'UPSERT';
  if (input.labelStatus === 'ACCEPTED' && input.score >= 85) return 'UPSERT';
  // Only a rejected golden direct source may be marked bad; the migration
  // trigger re-validates the same condition before the job is inserted.
  if (
    input.labelStatus === 'REJECTED' &&
    input.source.collection === 'golden_set' &&
    input.source.pointId !== null
  ) {
    return 'SET_BAD_CASE';
  }
  return null;
}
