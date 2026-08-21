import type { SafetyReasonCodeV1 } from '@echocue/contracts';

export const SAFETY_RULE_TYPES = ['TOPIC_PHRASE', 'KEYWORD', 'REGEX'] as const;
export type SafetyRuleType = (typeof SAFETY_RULE_TYPES)[number];

// A deterministic rule the runtime safety engine can execute. `text` is the
// topic phrase (negation/action already stripped), the plain keyword, or the
// regex pattern with the `regex:` prefix removed.
export interface CompiledSafetyRuleV1 {
  ruleType: SafetyRuleType;
  category: SafetyReasonCodeV1;
  text: string;
}

// clauseIndex is the position within the policy clauses; keyword/regex errors
// use -1 since they do not belong to any clause.
export interface CompileErrorV1 {
  clauseIndex: number;
  message: string;
}

export type CompileResult =
  | { valid: true; compiledRules: CompiledSafetyRuleV1[] }
  | { valid: false; errorCode: 'E_SAFETY_POLICY_INVALID'; errors: CompileErrorV1[] };

export interface CompilePolicyInput {
  compilerVersion?: string;
  policyText: string;
  keywords: string[];
}

export const SAFETY_POLICY_STATUSES = ['DRAFT', 'PUBLISHED', 'SUPERSEDED', 'INVALID'] as const;
export type SafetyPolicyStatus = (typeof SAFETY_POLICY_STATUSES)[number];

export interface CreatePolicyDraftParams {
  policyText: string;
  keywords?: string[];
}

// Metadata only: never derived from the encrypted content envelopes.
export interface SafetyPolicyVersionMeta {
  safetyPolicyVersion: string;
  status: SafetyPolicyStatus;
  compilerVersion: string;
  createdAt: string;
  publishedAt: string | null;
}

// Decrypted policy content, available only on main-process paths.
export interface PolicyContent {
  policyText: string;
  keywords: string[];
  compiledRules: CompiledSafetyRuleV1[] | null;
  validationErrors: CompileErrorV1[] | null;
}
