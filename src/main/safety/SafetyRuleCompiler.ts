import type { SafetyReasonCodeV1 } from '@echocue/contracts';
import type { CompileErrorV1, CompiledSafetyRuleV1, CompilePolicyInput, CompileResult } from './types.js';

export const SAFETY_COMPILER_VERSION = 'SafetyRuleCompilerV1' as const;

// The compiler only accepts explainable negation clauses; anything else must be
// surfaced to the UI as INVALID so it can never silently run as an empty rule.
const NEGATION_RE = /^(不要|禁止|请勿|别|勿|不能|不得)+/;
const ACTION_RE = /^(讨论|提及|提到|回应|涉及|回答|谈|聊|出现)/;
const VAGUE_TOPIC_RE = /不合适|敏感|大家|酌情|之类|等等/;
const TOPIC_SPLIT_RE = /[和与、]/;
const REGEX_PREFIX = 'regex:';

// Deterministic category classification: first matching entry wins, default
// TEAM_FORBIDDEN. Order matters for overlapping terms.
const CATEGORY_TAXONOMY: { category: SafetyReasonCodeV1; terms: string[] }[] = [
  { category: 'PII', terms: ['住址', '手机号', '电话', '姓名', '家庭', '地址'] },
  { category: 'TRANSACTION_PRICE', terms: ['价格', '多少钱', '最低价', '优惠', '交易', '下单'] },
  { category: 'COMPETITOR', terms: ['竞品', '别家', '友商', '其他平台'] },
  { category: 'POLITICS', terms: ['政治', '选举', '领导人'] },
  { category: 'MEDICAL_FINANCIAL_ADVICE', terms: ['医疗', '用药', '投资', '理财'] },
];

function classifyCategory(text: string): SafetyReasonCodeV1 {
  for (const entry of CATEGORY_TAXONOMY) {
    if (entry.terms.some((term) => text.includes(term))) {
      return entry.category;
    }
  }
  return 'TEAM_FORBIDDEN';
}

function compileClause(clause: string, index: number, rules: CompiledSafetyRuleV1[], errors: CompileErrorV1[]): void {
  const neg = NEGATION_RE.exec(clause);
  if (!neg) {
    errors.push({ clauseIndex: index, message: 'clause has no leading negation' });
    return;
  }
  let rest = clause.slice(neg[0].length);
  const act = ACTION_RE.exec(rest);
  if (act) {
    rest = rest.slice(act[0].length);
  }
  const topic = rest.trim();
  if (!topic) {
    errors.push({ clauseIndex: index, message: 'clause has no concrete topic' });
    return;
  }
  if (VAGUE_TOPIC_RE.test(topic)) {
    errors.push({ clauseIndex: index, message: 'topic is ambiguous or vague' });
    return;
  }
  const parts = topic
    .split(TOPIC_SPLIT_RE)
    .map((t) => t.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    // A pure separator topic is an empty topic; never a silently empty rule set.
    errors.push({ clauseIndex: index, message: 'clause has no concrete topic' });
    return;
  }
  for (const part of parts) {
    rules.push({ ruleType: 'TOPIC_PHRASE', category: classifyCategory(part), text: part });
  }
}

function compileKeyword(keyword: string, index: number, rules: CompiledSafetyRuleV1[], errors: CompileErrorV1[]): void {
  if (keyword.startsWith(REGEX_PREFIX)) {
    const pattern = keyword.slice(REGEX_PREFIX.length);
    if (!pattern) {
      errors.push({ clauseIndex: -1, message: `empty regex pattern for keyword #${index}` });
      return;
    }
    try {
      new RegExp(pattern);
    } catch {
      errors.push({ clauseIndex: -1, message: `invalid regex pattern for keyword #${index}` });
      return;
    }
    rules.push({ ruleType: 'REGEX', category: classifyCategory(pattern), text: pattern });
    return;
  }
  rules.push({ ruleType: 'KEYWORD', category: classifyCategory(keyword), text: keyword });
}

// Pure, zero-I/O compiler. Deterministic output per (policyText, keywords).
export function compilePolicy(input: CompilePolicyInput): CompileResult {
  if (input.compilerVersion !== undefined && input.compilerVersion !== SAFETY_COMPILER_VERSION) {
    return {
      valid: false,
      errorCode: 'E_SAFETY_POLICY_INVALID',
      errors: [{ clauseIndex: -1, message: `unsupported compiler version: ${input.compilerVersion}` }],
    };
  }

  const compiledRules: CompiledSafetyRuleV1[] = [];
  const errors: CompileErrorV1[] = [];

  const clauses = input.policyText
    .split(/[；;。！？!?]/)
    .map((c) => c.trim())
    .filter(Boolean);
  // clauseIndex counts only non-empty clauses, matching the filtered array.
  clauses.forEach((clause, index) => compileClause(clause, index, compiledRules, errors));

  input.keywords.forEach((raw, index) => {
    const keyword = raw.trim();
    if (keyword) {
      compileKeyword(keyword, index, compiledRules, errors);
    }
  });

  if (errors.length > 0) {
    return { valid: false, errorCode: 'E_SAFETY_POLICY_INVALID', errors };
  }
  return { valid: true, compiledRules };
}
