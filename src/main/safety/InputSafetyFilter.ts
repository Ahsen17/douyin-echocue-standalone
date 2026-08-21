import type { SafetyReasonCodeV1 } from '@echocue/contracts';
import type { CompiledSafetyRuleV1, SafetyRuleType } from './types.js';
import { detectBuiltinRisk } from './builtin-detectors.js';

export interface InputSafetyMatchedRule {
  ruleType: SafetyRuleType;
  category: SafetyReasonCodeV1;
  text: string;
}

// compiledRules === null models a missing/corrupt active policy (fail closed).
export interface InputSafetyFilterInput {
  normalizedText: string;
  compiledRules: CompiledSafetyRuleV1[] | null;
}

export type InputSafetyDecision =
  | { allow: true; reason: null; matchedRule: null }
  | { allow: false; reason: SafetyReasonCodeV1; matchedRule: InputSafetyMatchedRule | null };

const FAIL_CLOSED: InputSafetyDecision = { allow: false, reason: 'SAFETY_ENGINE_ERROR', matchedRule: null };

// ARCH §4.4 evaluation order: built-in detectors, then exact keywords, then
// controlled regex, then natural-language compiled topics. The compiler emits
// TOPIC_PHRASE rules before KEYWORD/REGEX, so reorder rather than trust array order.
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
// missing policy fails closed to SAFETY_ENGINE_ERROR, never an allow.
export function evaluateInputSafety(input: InputSafetyFilterInput): InputSafetyDecision {
  if (input.compiledRules === null) {
    return FAIL_CLOSED;
  }
  try {
    const builtin = detectBuiltinRisk(input.normalizedText);
    if (builtin !== null) {
      return { allow: false, reason: builtin, matchedRule: null };
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
