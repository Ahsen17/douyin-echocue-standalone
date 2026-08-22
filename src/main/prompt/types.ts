import type { RetrievalHitV1, SemanticTypeV1, SourceCollectionV1 } from '@echocue/contracts';

/** Frozen persona snapshot loaded once at attempt start (ARCH §4.2). */
export interface PersonaSnapshot {
  personaId: string;
  personaVersion: string;
  content: string;
  contentHmac: string;
}

/** Frozen safety policy snapshot bound to the attempt (ARCH §4.4). */
export interface SafetySnapshot {
  version: string;
  policyText: string;
  keywords: string[];
}

/**
 * Input to the deterministic PromptAssembler (LLM §3). All content here is
 * treated as untrusted data and is JSON-encoded at render time; none of it may
 * carry an API key, Authorization header, raw score, confidence, threshold,
 * point ID, or internal reason code (LLM §3.2).
 */
export interface PromptInput {
  targetComment: string;
  personaSnapshot: PersonaSnapshot;
  safetySnapshot: SafetySnapshot;
  mergedTopK: readonly RetrievalHitV1[];
  /** Total context budget in estimated tokens (LLM §3.3 POC item). */
  maxContextBudget?: number;
}

/** Reference case as serialized into the user message (no case/point IDs). */
export interface ReferenceCase {
  source: SourceCollectionV1;
  semantic_type: SemanticTypeV1;
  comment: string;
  description?: string;
  reply?: string;
  cues?: string[];
}

/** Facts about which cases were dropped for the budget, for audit (LLM §7). */
export interface TruncationLog {
  excludedCases: string[];
}

/** Rendered system+user messages plus audit metadata. */
export interface RenderedPrompt {
  system: string;
  user: string;
  templateVersion: string;
  assemblerVersion: string;
  truncationLog: TruncationLog;
}
