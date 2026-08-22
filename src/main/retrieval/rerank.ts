import type { RetrievalHitV1 } from '@echocue/contracts';
import type { RetrievalRawHit } from './retriever.js';
import {
  DEFAULT_CALIBRATION_ARTIFACT_V1,
  calibrateHits,
  type CalibrationArtifactV1,
} from './calibration.js';

export interface RerankInput {
  readonly preHits: readonly RetrievalRawHit[];
  readonly goldenHits: readonly RetrievalRawHit[];
}

export interface RerankOptions {
  topK?: number;
  artifact?: CalibrationArtifactV1;
}

export interface RerankResult {
  readonly preHits: RetrievalHitV1[];
  readonly goldenHits: RetrievalHitV1[];
  readonly mergedTopK: RetrievalHitV1[];
}

const DEFAULT_TOP_K = 10;

function compareConfidence(a: RetrievalHitV1, b: RetrievalHitV1): number {
  if (b.retrievalConfidence !== a.retrievalConfidence) {
    return b.retrievalConfidence - a.retrievalConfidence;
  }
  if (b.rawScore !== a.rawScore) {
    return b.rawScore - a.rawScore;
  }
  // Deterministic tie-break on stable point id.
  return a.pointId < b.pointId ? -1 : a.pointId > b.pointId ? 1 : 0;
}

export function rerank(input: RerankInput, options: RerankOptions = {}): RerankResult {
  const artifact = options.artifact ?? DEFAULT_CALIBRATION_ARTIFACT_V1;
  if (options.topK !== undefined && !Number.isFinite(options.topK)) {
    throw new Error('rerank topK must be a finite number');
  }
  const topK = Math.max(1, Math.floor(options.topK ?? DEFAULT_TOP_K));

  const preHits = calibrateHits(input.preHits, 'pre_set', artifact);
  const goldenHits = calibrateHits(input.goldenHits, 'golden_set', artifact);

  const merged = [...preHits, ...goldenHits]
    .sort(compareConfidence)
    .slice(0, topK)
    .map((hit, index) => ({ ...hit, rank: index + 1 }));

  return { preHits, goldenHits, mergedTopK: merged };
}
