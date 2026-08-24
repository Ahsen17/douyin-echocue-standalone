import type {
  OutputValidationReasonV1,
  SuggestionSourceV1,
  ValidatedSuggestionV1,
} from '@echocue/contracts';
import type { PersonaSnapshot, SafetySnapshot } from '../prompt/types.js';
import type { CompiledRiskFilter } from '../safety/risk-filter-config.js';
import type { CompiledSafetyRuleV1 } from '../safety/types.js';

export type { ValidatedSuggestionV1 };

// Versioned validator identity (LLM §5.2). Bumping any rule set requires a new
// version so old OUTPUT_VALIDATION snapshots stay reproducible.
export const OUTPUT_VALIDATOR_VERSION_V1 = 'SuggestionOutputValidatorV1';
export const OUTPUT_SAFETY_MAPPING_VERSION_V1 = 'v1';
export const PERSONA_BOUNDARY_RULES_VERSION_V1 = 'v1';
export const INVISIBLE_CONTROL_REJECT_VERSION_V1 = 'v1';

/** Candidate to validate: the provider wire shape, or a golden reply/cues adapted to it. */
export interface CandidateSuggestion {
  quick_reply: string;
  cues: string[];
}

/** Team boundary data for the deterministic persona check (ARCH §4.3). */
export interface TeamMemberNameV1 {
  personaId: string;
  displayName: string;
  enabledAliases: readonly string[];
}

export type CancelTraceReason =
  | 'STALE_SESSION'
  | 'STALE_WINDOW'
  | 'DEADLINE_EXCEEDED'
  | 'USER_STOPPED'
  | 'ROOM_ENDED'
  | 'SOURCE_ERROR'
  | 'AUDIT_FAILURE';

export interface OutputValidationContext {
  source: SuggestionSourceV1;
  /** Frozen persona snapshot (prompt/types.ts), loaded at attempt start. */
  personaSnapshot: PersonaSnapshot;
  /** Frozen safety policy snapshot bound to the attempt (ARCH §4.4). */
  safetySnapshot: SafetySnapshot;
  /** The same compiled rules used by input filtering (frozen version). */
  compiledRules: CompiledSafetyRuleV1[] | null;
  /** WP-10: configured risk filter (empty ⇒ no risk filtering on output). */
  riskFilter?: CompiledRiskFilter | null;
  /** All team members; used to reject mentions of non-current members. */
  memberNames: readonly TeamMemberNameV1[];
  /** The routed persona; its own name is allowed as self-reference. */
  currentPersonaId: string;
  /** Versioned, POC-tunable phrases the host must never promise. */
  forbiddenPromiseTerms: readonly string[];
  expected: { sessionId: string; traceId: string; windowVersion: number };
  actual: { sessionId: string; traceId: string; windowVersion: number };
  /** Injected clock (M5-08 replaces with a real monotonic source). */
  nowMonotonicMs: number;
  freshnessDeadlineMonotonicMs: number;
  abortSignal?: AbortSignal;
}

export type OutputValidationResult =
  | { ok: true; output: ValidatedSuggestionV1 }
  | { ok: false; kind: 'REJECTED'; reasonCodes: OutputValidationReasonV1[] }
  | { ok: false; kind: 'STALE'; traceReason: CancelTraceReason };
