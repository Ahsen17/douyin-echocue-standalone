import type { SafetyReasonCodeV1 } from '@echocue/contracts';
import { evaluateInputSafety } from '../safety/index.js';
import { countHanCharacters, isOnlyPunctuationOrWhitespace } from '../util/count-han.js';
import { OUTPUT_SAFETY_MAPPING_VERSION_V1 } from './types.js';
import type {
  CancelTraceReason,
  CandidateSuggestion,
  OutputValidationContext,
  OutputValidationResult,
  TeamMemberNameV1,
} from './types.js';

// Internal shape schema for step 2 (LLM §5.1): length limits are owned by the
// han-count rules (step 4), not by JSON Schema maxLength, so this schema
// deliberately carries no maxLength.
export const SUGGESTION_OUTPUT_MIN_REPLY_LENGTH = 1;
export const SUGGESTION_OUTPUT_MAX_REPLY_HAN = 80;
export const SUGGESTION_OUTPUT_CUE_MIN = 2;
export const SUGGESTION_OUTPUT_CUE_MAX = 3;
export const SUGGESTION_OUTPUT_MAX_CUE_HAN = 40;

// Invisible control characters never belong in a displayable field (LLM §5.2
// step 3): C0/C1, zero-width (200B-200D), LRM/RLM (200E-200F), bidi controls
// (202A-202E), joiners (2060-206F), BOM (FEFF), soft hyphen (00AD).
const INVISIBLE_CONTROL_RE = new RegExp(
  '[' +
    '\\u0000-\\u001f' +
    '\\u007f-\\u009f' +
    '\\u00ad' +
    '\\u200b-\\u200f' +
    '\\u202a-\\u202e' +
    '\\u2060-\\u206f' +
    '\\ufeff' +
    ']',
);

function hasInvisibleControl(s: string): boolean {
  return INVISIBLE_CONTROL_RE.test(s);
}

/** NFKC + trim, the only normalization allowed (never fills in or rewrites). */
function normalizeField(value: string): string {
  return value.normalize('NFKC').trim();
}

function isShapeValid(candidate: CandidateSuggestion): boolean {
  // LLM §5.1 logical schema sets additionalProperties:false; extra keys are a
  // schema failure, never silently dropped.
  const keys = Object.keys(candidate);
  if (keys.length !== 2 || !keys.includes('quick_reply') || !keys.includes('cues')) return false;
  if (typeof candidate.quick_reply !== 'string') return false;
  if (!Array.isArray(candidate.cues)) return false;
  // Cue arity (2–3) is a structure/length concern (step 4, CUE_COUNT_INVALID),
  // not a schema-typing concern; only element types are checked here.
  return candidate.cues.every((cue) => typeof cue === 'string');
}

function checkStructureAndLength(candidate: CandidateSuggestion): {
  reasonCodes: Array<'EMPTY_QUICK_REPLY' | 'QUICK_REPLY_TOO_LONG' | 'CUE_COUNT_INVALID' | 'CUE_EMPTY' | 'CUE_TOO_LONG' | 'CUE_DUPLICATE'>;
} {
  const reasonCodes: Array<'EMPTY_QUICK_REPLY' | 'QUICK_REPLY_TOO_LONG' | 'CUE_COUNT_INVALID' | 'CUE_EMPTY' | 'CUE_TOO_LONG' | 'CUE_DUPLICATE'> = [];
  const reply = normalizeField(candidate.quick_reply);
  if (reply.length < SUGGESTION_OUTPUT_MIN_REPLY_LENGTH || isOnlyPunctuationOrWhitespace(reply)) {
    reasonCodes.push('EMPTY_QUICK_REPLY');
  } else if (countHanCharacters(reply) > SUGGESTION_OUTPUT_MAX_REPLY_HAN) {
    reasonCodes.push('QUICK_REPLY_TOO_LONG');
  }

  if (candidate.cues.length < SUGGESTION_OUTPUT_CUE_MIN || candidate.cues.length > SUGGESTION_OUTPUT_CUE_MAX) {
    reasonCodes.push('CUE_COUNT_INVALID');
  }

  const seen = new Set<string>();
  for (const raw of candidate.cues) {
    const cue = normalizeField(raw);
    if (cue.length === 0 || isOnlyPunctuationOrWhitespace(cue)) {
      reasonCodes.push('CUE_EMPTY');
    } else if (countHanCharacters(cue) > SUGGESTION_OUTPUT_MAX_CUE_HAN) {
      reasonCodes.push('CUE_TOO_LONG');
    }
    if (seen.has(cue)) {
      reasonCodes.push('CUE_DUPLICATE');
    }
    seen.add(cue);
  }
  return { reasonCodes };
}

// Map an input-safety decision to output validation reason codes (versioned in
// OUTPUT_SAFETY_MAPPING_VERSION_V1). SAFETY_ENGINE_ERROR fails closed; a hit on
// a team-configured PII rule still belongs to PERSONAL_INFO_HIT.
function mapSafetyReason(reason: SafetyReasonCodeV1, matchedRule: boolean): Array<'RISK_RULE_HIT' | 'PERSONAL_INFO_HIT' | 'FORBIDDEN_POLICY_HIT'> {
  if (reason === 'PII') return ['PERSONAL_INFO_HIT'];
  if (reason === 'TEAM_FORBIDDEN' || matchedRule) return ['FORBIDDEN_POLICY_HIT'];
  return ['RISK_RULE_HIT'];
}

function checkOutputSafety(
  texts: readonly string[],
  compiledRules: OutputValidationContext['compiledRules'],
): Array<'RISK_RULE_HIT' | 'PERSONAL_INFO_HIT' | 'FORBIDDEN_POLICY_HIT'> {
  const hits: Array<'RISK_RULE_HIT' | 'PERSONAL_INFO_HIT' | 'FORBIDDEN_POLICY_HIT'> = [];
  for (const text of texts) {
    const decision = evaluateInputSafety({ normalizedText: text, compiledRules });
    if (!decision.allow) {
      const mapped = mapSafetyReason(decision.reason, decision.matchedRule !== null);
      for (const code of mapped) {
        if (!hits.includes(code)) hits.push(code);
      }
    }
  }
  return hits;
}

function memberNameTexts(member: TeamMemberNameV1): readonly string[] {
  return [member.displayName, ...member.enabledAliases];
}

// Deterministic persona/fact boundary (ARCH §4.3). Fails closed when the team
// boundary cannot be proven: empty member list or an unknown current persona.
function checkPersonaBoundary(
  texts: readonly string[],
  context: OutputValidationContext,
): boolean {
  if (context.memberNames.length === 0) return false;
  const current = context.memberNames.find((m) => m.personaId === context.currentPersonaId);
  if (current === undefined) return false;

  const joined = texts.join('\n');
  for (const member of context.memberNames) {
    if (member.personaId === context.currentPersonaId) continue;
    for (const name of memberNameTexts(member)) {
      if (name.length > 0 && joined.includes(name)) return false;
    }
  }
  for (const term of context.forbiddenPromiseTerms) {
    if (term.length > 0 && joined.includes(term)) return false;
  }
  return true;
}

function checkFreshness(
  context: OutputValidationContext,
): { ok: true } | { ok: false; traceReason: CancelTraceReason } {
  // The orchestrator's isFresh() decides the concrete cancel reason (USER_STOPPED
  // / ROOM_ENDED / SOURCE_ERROR) before calling the validator; a fired abort
  // here is a defensive backstop that cannot name the caller's reason.
  if (context.abortSignal?.aborted === true) {
    return { ok: false, traceReason: 'USER_STOPPED' };
  }
  if (
    context.actual.sessionId !== context.expected.sessionId ||
    // No dedicated STALE_TRACE code exists; a trace mismatch is the closest
    // "this response belongs to a different message" signal (LLM §5.2 step 7).
    context.actual.traceId !== context.expected.traceId
  ) {
    return { ok: false, traceReason: 'STALE_SESSION' };
  }
  if (context.actual.windowVersion !== context.expected.windowVersion) {
    return { ok: false, traceReason: 'STALE_WINDOW' };
  }
  if (context.nowMonotonicMs > context.freshnessDeadlineMonotonicMs) {
    return { ok: false, traceReason: 'DEADLINE_EXCEEDED' };
  }
  return { ok: true };
}

/**
 * Shared output validator (LLM §5.2), used for both golden direct payloads and
 * LLM output. Runs a fixed 1→7 order and returns machine-readable reasons.
 * Failures never retry, degrade, or let the renderer self-correct.
 */
export class SuggestionOutputValidator {
  validate(candidate: CandidateSuggestion, context: OutputValidationContext): OutputValidationResult {
    // Step 1 parse: candidate must be a plain JSON object, never an array.
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      return { ok: false, kind: 'REJECTED', reasonCodes: ['JSON_PARSE_FAILED'] };
    }
    // Step 2 schema: fields, types, required arity, no length coupling here.
    if (!isShapeValid(candidate)) {
      return { ok: false, kind: 'REJECTED', reasonCodes: ['JSON_SCHEMA_FAILED'] };
    }
    // Step 3 normalize + reject invisible control characters in display fields.
    const reply = normalizeField(candidate.quick_reply);
    const cues = candidate.cues.map(normalizeField);
    if (hasInvisibleControl(reply) || cues.some(hasInvisibleControl)) {
      return { ok: false, kind: 'REJECTED', reasonCodes: ['UNSAFE_CONTROL_CHAR'] };
    }
    // Step 4 structure & length.
    const structural = checkStructureAndLength(candidate);
    if (structural.reasonCodes.length > 0) {
      return { ok: false, kind: 'REJECTED', reasonCodes: structural.reasonCodes };
    }
    // Step 5 safety & taboo against the frozen compiled rules.
    const safety = checkOutputSafety([reply, ...cues], context.compiledRules);
    if (safety.length > 0) {
      return { ok: false, kind: 'REJECTED', reasonCodes: safety };
    }
    // Step 6 persona & fact boundary.
    if (!checkPersonaBoundary([reply, ...cues], context)) {
      return { ok: false, kind: 'REJECTED', reasonCodes: ['PERSONA_REVIEW_UNCERTAIN'] };
    }
    // Step 7 freshness & cancellation.
    const freshness = checkFreshness(context);
    if (!freshness.ok) {
      return { ok: false, kind: 'STALE', traceReason: freshness.traceReason };
    }
    return {
      ok: true,
      output: { quickReply: reply, cues, source: context.source },
    };
  }
}

export { OUTPUT_SAFETY_MAPPING_VERSION_V1 };
