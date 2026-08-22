import type {
  GoldenSetPayloadV1,
  RetrievalHitV1,
  RetrievalResultV1,
  TraceReasonCodeV1,
} from '@echocue/contracts';
import { RetrievalResultV1Schema } from '@echocue/contracts';

export interface DirectPushContext {
  readonly personaId: string;
  readonly personaVersion: string;
  readonly directPushThreshold: number;
}

export interface DirectPushDecision {
  readonly eligible: boolean;
  readonly pointId?: string;
  readonly reason: TraceReasonCodeV1;
}

// Golden direct-push (CONTRACT §4.2 / ARCH §4.3): only the current persona's
// golden Top-1 with confidence >= threshold, enabled and not a bad case, may be
// pushed without LLM. Anything else routes to the LLM path.
export function evaluateDirectPush(
  mergedTopK: readonly RetrievalHitV1[],
  context: DirectPushContext,
): DirectPushDecision {
  if (
    !Number.isFinite(context.directPushThreshold) ||
    context.directPushThreshold < 0 ||
    context.directPushThreshold > 1
  ) {
    throw new Error('directPushThreshold must be a finite number within [0,1]');
  }
  const top = mergedTopK[0];
  if (top === undefined) {
    return { eligible: false, reason: 'LLM_REQUIRED' };
  }
  if (top.collection !== 'golden_set') {
    return { eligible: false, reason: 'LLM_REQUIRED' };
  }
  if (top.retrievalConfidence < context.directPushThreshold) {
    return { eligible: false, reason: 'LLM_REQUIRED' };
  }

  const payload = top.payload as GoldenSetPayloadV1;
  if (!payload.enabled || payload.is_bad_case) {
    return { eligible: false, reason: 'LLM_REQUIRED' };
  }
  if (payload.persona_id !== context.personaId || payload.persona_version !== context.personaVersion) {
    return { eligible: false, reason: 'LLM_REQUIRED' };
  }

  return { eligible: true, pointId: top.pointId, reason: 'GOLDEN_DIRECT_ELIGIBLE' };
}

export interface BuildRetrievalResultArgs {
  readonly traceId: string;
  readonly calibrationVersion: string;
  readonly goldenHits: readonly RetrievalHitV1[];
  readonly preHits: readonly RetrievalHitV1[];
  readonly mergedTopK: readonly RetrievalHitV1[];
  readonly directPush: DirectPushDecision;
}

export function buildRetrievalResult(args: BuildRetrievalResultArgs): RetrievalResultV1 {
  if (!args.directPush.eligible && args.directPush.pointId !== undefined) {
    throw new Error('ineligible direct push must not carry a pointId');
  }
  const result = {
    traceId: args.traceId,
    calibrationVersion: args.calibrationVersion,
    goldenHits: args.goldenHits,
    preHits: args.preHits,
    mergedTopK: args.mergedTopK,
    directPushEligible: args.directPush.eligible,
    ...(args.directPush.pointId !== undefined ? { directPointId: args.directPush.pointId } : {}),
  };
  return RetrievalResultV1Schema.parse(result);
}
