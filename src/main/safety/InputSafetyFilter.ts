import type { SafetyReasonCodeV1 } from '@echocue/contracts';
import type { CompiledSafetyRuleV1, SafetyRuleType } from './types.js';
import { detectConfiguredRisk, type CompiledRiskFilter } from './risk-filter-config.js';

export interface InputSafetyMatchedRule {
  ruleType: SafetyRuleType;
  category: SafetyReasonCodeV1;
  text: string;
}

// compiledRules === null models a missing/corrupt active policy (fail closed).
export interface InputSafetyFilterInput {
  normalizedText: string;
  compiledRules: CompiledSafetyRuleV1[] | null;
  /** WP-10: configured risk filter (empty ⇒ no risk filtering at all). */
  riskFilter?: CompiledRiskFilter | null;
}

// reason is the user typeId for a configured-risk hit, a policy category for a
// compiled rule, or SAFETY_ENGINE_ERROR on fail-closed. Widened from the enum so
// user-defined typeIds cross this boundary without a second registry.
export type InputSafetyDecision =
  | { allow: true; reason: null; matchedRule: null }
  | { allow: false; reason: string; matchedRule: InputSafetyMatchedRule | null };

const FAIL_CLOSED: InputSafetyDecision = { allow: false, reason: 'SAFETY_ENGINE_ERROR', matchedRule: null };

// ARCH §4.4 evaluation order: configured risk filter first, then exact keywords,
// then controlled regex, then natural-language compiled topics. The compiler
// emits TOPIC_PHRASE rules before KEYWORD/REGEX, so reorder rather than trust
// array order.
const RULE_TYPE_PRIORITY: readonly SafetyRuleType[] = ['KEYWORD', 'REGEX', 'TOPIC_PHRASE'];

function orderedCompiledRules(rules: CompiledSafetyRuleV1[]): CompiledSafetyRuleV1[] {
  for (const rule of rules) {
    if (!RULE_TYPE_PRIORITY.includes(rule.ruleType)) {
      // Unknown rule type from a future compiler: never silently allow.
      throw new Error(`unknown safety rule type: ${String(rule.ruleType)}`);
    }
  }
  return RULE_TYPE_PRIORITY.flatMap((type) => rules.filter((r) => r.ruleType === type));
}

function matchCompiledRule(normalizedText: string, rule: CompiledSafetyRuleV1): boolean {
  switch (rule.ruleType) {
    case 'KEYWORD':
    case 'TOPIC_PHRASE':
      return normalizedText.includes(rule.text);
    case 'REGEX':
      return new RegExp(rule.text).test(normalizedText);
    default: {
      throw new Error(`unknown safety rule type: ${String(rule.ruleType)}`);
    }
  }
}

// Deterministic input safety check. Any hit is FILTERED; an engine fault or a
// missing policy fails closed to SAFETY_ENGINE_ERROR, never an allow. The policy
// rules and the configured risk filter are orthogonal (WP-10): empty riskFilter
// simply skips the risk step.
export function evaluateInputSafety(input: InputSafetyFilterInput): InputSafetyDecision {
  if (input.compiledRules === null) {
    return FAIL_CLOSED;
  }
  try {
    if (input.riskFilter !== null && input.riskFilter !== undefined) {
      const risk = detectConfiguredRisk(input.riskFilter, input.normalizedText);
      if (risk !== null) {
        return { allow: false, reason: risk.typeId, matchedRule: null };
      }
    }
    for (const rule of orderedCompiledRules(input.compiledRules)) {
      if (matchCompiledRule(input.normalizedText, rule)) {
        return {
          allow: false,
          reason: rule.category,
          matchedRule: { ruleType: rule.ruleType, category: rule.category, text: rule.text },
        };
      }
    }
    return { allow: true, reason: null, matchedRule: null };
  } catch {
    return FAIL_CLOSED;
  }
}
