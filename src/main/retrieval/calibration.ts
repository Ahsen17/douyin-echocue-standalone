import type { RetrievalHitV1, SourceCollectionV1 } from '@echocue/contracts';
import { SourceCollectionV1Schema } from '@echocue/contracts';
import type { RetrievalRawHit } from './retriever.js';

export interface SigmoidCalibrationV1 {
  readonly center: number;
  readonly scale: number;
}

// Versioned internal retrieval config (CONTRACT §4.4: calibration params and
// thresholds live only in internal config/audit snapshots, never UI/IPC).
export interface CalibrationArtifactV1 {
  readonly artifactId: string;
  readonly version: string;
  readonly preSet: SigmoidCalibrationV1;
  readonly goldenSet: SigmoidCalibrationV1;
  readonly semanticDiscardConfidence: number;
}

// POC initial placeholder; M3-09 fixes params with real client samples.
// artifactId aligns with Bm25ZhJiebaProfileV1.calibrationArtifactId;
// version aligns with settings.internalRetrieval.calibrationVersion.
export const DEFAULT_CALIBRATION_ARTIFACT_V1: CalibrationArtifactV1 = {
  artifactId: 'pending-calibration',
  version: 'v1.0',
  preSet: { center: 0, scale: 2 },
  goldenSet: { center: 0, scale: 2 },
  semanticDiscardConfidence: 0.9,
};

export function validateCalibrationArtifact(artifact: CalibrationArtifactV1): void {
  if (artifact.preSet.scale <= 0 || artifact.goldenSet.scale <= 0) {
    throw new Error(`calibration artifact scale must be positive: ${artifact.artifactId}`);
  }
  if (
    artifact.semanticDiscardConfidence < 0 ||
    artifact.semanticDiscardConfidence > 1
  ) {
    throw new Error(`calibration artifact discard confidence out of range: ${artifact.artifactId}`);
  }
  if (artifact.version.trim().length === 0 || artifact.artifactId.trim().length === 0) {
    throw new Error('calibration artifact id/version must not be empty');
  }
}

export function calibrateScore(
  rawScore: number,
  collection: SourceCollectionV1,
  artifact: CalibrationArtifactV1,
): number {
  validateCalibrationArtifact(artifact);
  const params = collection === 'pre_set' ? artifact.preSet : artifact.goldenSet;
  const z = (rawScore - params.center) / params.scale;
  // 1/(1+exp(-z)); monotonic in rawScore, naturally in (0,1).
  return 1 / (1 + Math.exp(-z));
}

export function calibrateHits(
  hits: readonly RetrievalRawHit[],
  collection: SourceCollectionV1,
  artifact: CalibrationArtifactV1,
): RetrievalHitV1[] {
  SourceCollectionV1Schema.parse(collection);
  return hits.map((hit) => ({
    pointId: hit.pointId,
    caseId: hit.caseId,
    collection,
    rawScore: hit.rawScore,
    retrievalConfidence: calibrateScore(hit.rawScore, collection, artifact),
    rank: hit.rank,
    payload: hit.payload,
  }));
}
