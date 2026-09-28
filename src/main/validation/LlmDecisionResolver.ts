import type { SemanticTypeV1, SuggestionDecisionV2 } from '@echocue/contracts';
import type { CandidateSuggestion } from './types.js';

// Discard-type semantic votes (CONTRACT §4.3), shared with the BM25 initial
// filter (retrieval/semantic-filter.ts) — the LLM judgment is a third,
// additive backstop, not a replacement.
const DISCARD_SEMANTIC_TYPES: readonly SemanticTypeV1[] = ['filter_risk', 'low_value'];

export type LlmDecision =
  | { kind: 'reject'; traceReason: 'LLM_SEMANTIC_DISCARD'; semanticType: SemanticTypeV1 }
  | { kind: 'generate'; semanticType: SemanticTypeV1; candidate: CandidateSuggestion };

/**
 * Deterministic precedence over the model's own action/semantic_type pair
 * (LLM §5.2): the model's self-judgment is never trusted on its own.
 * `action:'reject'` always discards (even for a positive semantic_type —
 * fail-safe), and `action:'generate'` with a discard-type semantic_type is
 * overridden to discard in code.
 */
export function resolveLlmDecision(output: SuggestionDecisionV2): LlmDecision {
  if (output.action === 'reject') {
    return { kind: 'reject', traceReason: 'LLM_SEMANTIC_DISCARD', semanticType: output.semantic_type };
  }
  if (DISCARD_SEMANTIC_TYPES.includes(output.semantic_type)) {
    return { kind: 'reject', traceReason: 'LLM_SEMANTIC_DISCARD', semanticType: output.semantic_type };
  }
  return {
    kind: 'generate',
    semanticType: output.semantic_type,
    candidate: { quick_reply: output.quick_reply, cues: output.cues },
  };
}
