import type { RetrievalHitV1 } from '@echocue/contracts';
import type { RetrievalSearchResult } from './retriever.js';
import { DEFAULT_CALIBRATION_ARTIFACT_V1, type CalibrationArtifactV1 } from './calibration.js';
import { rerank } from './rerank.js';
import {
  evaluateSemanticFilter,
  type SemanticFilterDecision,
} from './semantic-filter.js';

export interface EvaluateOptions {
  topK?: number;
  artifact?: CalibrationArtifactV1;
}

export interface CalibratedRetrieval {
  readonly calibrationVersion: string;
  readonly goldenHits: RetrievalHitV1[];
  readonly preHits: RetrievalHitV1[];
  readonly mergedTopK: RetrievalHitV1[];
  readonly semanticDecision: SemanticFilterDecision;
}

export function evaluateRetrieval(
  raw: RetrievalSearchResult,
  options: EvaluateOptions = {},
): CalibratedRetrieval {
  const artifact = options.artifact ?? DEFAULT_CALIBRATION_ARTIFACT_V1;
  const ranked = rerank(
    { preHits: raw.preHits, goldenHits: raw.goldenHits },
    { topK: options.topK, artifact },
  );
  return {
    calibrationVersion: artifact.version,
    goldenHits: ranked.goldenHits,
    preHits: ranked.preHits,
    mergedTopK: ranked.mergedTopK,
    semanticDecision: evaluateSemanticFilter(ranked.mergedTopK, artifact),
  };
}
