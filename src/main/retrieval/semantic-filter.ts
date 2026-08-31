import type { RetrievalHitV1, SemanticTypeV1, TraceReasonCodeV1 } from '@echocue/contracts';
import { SemanticTypeV1Schema } from '@echocue/contracts';
import type { CalibrationArtifactV1 } from './calibration.js';

// Positive interaction types (CONTRACT §4.3): any hit of these types overrides
// a low_value/filter_risk discard as long as it has higher confidence.
export const POSITIVE_SEMANTIC_TYPES: readonly SemanticTypeV1[] = [
  'persona_relevant',
  'positive_praise',
  'funny_joke',
  'interactive_question',
  'atmosphere_boost',
];

const DISCARD_SEMANTIC_TYPES: readonly SemanticTypeV1[] = ['filter_risk', 'low_value'];

export interface SemanticFilterDecision {
  readonly action: 'DISCARD' | 'CANDIDATE';
  readonly reason?: TraceReasonCodeV1;
  readonly topSemanticType: SemanticTypeV1;
  readonly discardedBy?: 'filter_risk' | 'low_value';
}

// Unknown semantic_type is a gray zone (CONTRACT §4.3): never treated as
// discardable, never as positive — it simply does not vote.
function semanticTypeOf(hit: RetrievalHitV1): SemanticTypeV1 | undefined {
  const value = (hit.payload as { semantic_type?: SemanticTypeV1 }).semantic_type;
  return value !== undefined && SemanticTypeV1Schema.safeParse(value).success ? value : undefined;
}

export function evaluateSemanticFilter(
  mergedTopK: readonly RetrievalHitV1[],
  artifact: CalibrationArtifactV1,
): SemanticFilterDecision {
  if (mergedTopK.length === 0) {
    return { action: 'CANDIDATE', topSemanticType: 'low_value' };
  }

  // mergedTopK is sorted by confidence desc, so the top hit's semantic type is
  // the conclusion type (fallback only for malformed payloads).
  const topSemanticType: SemanticTypeV1 = semanticTypeOf(mergedTopK[0]) ?? 'low_value';
  let maxDiscardConfidence = -1;
  let discardedBy: 'filter_risk' | 'low_value' | undefined;
  let maxPositiveConfidence = -1;

  for (const hit of mergedTopK) {
    const type = semanticTypeOf(hit);
    if (type === undefined) continue;
    if (DISCARD_SEMANTIC_TYPES.includes(type)) {
      if (hit.retrievalConfidence > maxDiscardConfidence) {
        maxDiscardConfidence = hit.retrievalConfidence;
        discardedBy = type as 'filter_risk' | 'low_value';
      }
    } else if (POSITIVE_SEMANTIC_TYPES.includes(type)) {
      if (hit.retrievalConfidence > maxPositiveConfidence) {
        maxPositiveConfidence = hit.retrievalConfidence;
      }
    }
  }

  const discardCandidateConfident = maxDiscardConfidence >= artifact.semanticDiscardConfidence;
  const noHigherPositive = maxPositiveConfidence < maxDiscardConfidence;

  if (discardCandidateConfident && noHigherPositive && discardedBy !== undefined) {
    return {
      action: 'DISCARD',
      // Only the discard-type semantic vote (filter_risk vs low_value) picks the reason.
      reason: discardedBy === 'filter_risk' ? 'FILTER_RISK_DISCARD' : 'LOW_VALUE',
      topSemanticType,
      discardedBy,
    };
  }

  return { action: 'CANDIDATE', topSemanticType };
}
