import type { SafetyReasonCodeV1 } from '@echocue/contracts';
import { BUILTIN_CATEGORY_TERMS } from '../safety/builtin-detectors.js';
import type { CompiledRiskFilter } from '../safety/risk-filter-config.js';
import type { CompiledSafetyRuleV1 } from '../safety/types.js';
import { evaluateInputSafety, normalizeComment, type InputSafetyDecision } from '../safety/index.js';
import type { BenchmarkSample, ExpectedSafetyAction } from './types.js';

// WP-10: the benchmark measures base risk-detector accuracy; the former always-on
// builtin terms are now expressed as a configured risk filter with the same
// typeIds, so expected reasons (PII/ABUSE/…) stay aligned.
const BUILTIN_RISK_FILTER: CompiledRiskFilter = (
  Object.entries(BUILTIN_CATEGORY_TERMS) as Array<[string, readonly string[]]>
).map(([typeId, terms]) => ({ typeId, label: typeId, terms }));

export type SafetyFailureKind = 'miss' | 'false_positive' | 'wrong_reason';

export interface SafetySampleResult {
  caseId: string;
  expectedSafetyAction: ExpectedSafetyAction;
  expectedSafetyReason: SafetyReasonCodeV1 | null;
  decision: InputSafetyDecision;
  passed: boolean;
  failure: SafetyFailureKind | null;
}

export interface SafetyCategoryStat {
  category: string;
  total: number;
  expectedFilter: number;
  actualFilter: number;
  missed: number;
  falsePositive: number;
}

export interface SafetyBenchmarkResult {
  total: number;
  passed: number;
  missed: number;
  falsePositive: number;
  wrongReason: number;
  byCategory: SafetyCategoryStat[];
  perSample: SafetySampleResult[];
}

function evaluateSafetySample(sample: BenchmarkSample, compiledRules: CompiledSafetyRuleV1[]): SafetySampleResult {
  const decision = evaluateInputSafety({
    normalizedText: normalizeComment(sample.text),
    compiledRules,
    riskFilter: BUILTIN_RISK_FILTER,
  });
  let passed: boolean;
  let failure: SafetyFailureKind | null;
  if (sample.expectedSafetyAction === 'filter') {
    if (decision.allow) {
      passed = false;
      failure = 'miss';
    } else if (decision.reason !== sample.expectedSafetyReason) {
      passed = false;
      failure = 'wrong_reason';
    } else {
      passed = true;
      failure = null;
    }
  } else if (!decision.allow) {
    passed = false;
    failure = 'false_positive';
  } else {
    passed = true;
    failure = null;
  }
  return {
    caseId: sample.caseId,
    expectedSafetyAction: sample.expectedSafetyAction,
    expectedSafetyReason: sample.expectedSafetyReason,
    decision,
    passed,
    failure,
  };
}

// Aggregates per-category counts for the POC §3 table; categories are the
// expected reason (or 'allow' for positive samples).
function aggregateSafety(perSample: SafetySampleResult[]): SafetyBenchmarkResult {
  const byCategory = new Map<string, SafetyCategoryStat>();
  let passed = 0;
  let missed = 0;
  let falsePositive = 0;
  let wrongReason = 0;
  for (const r of perSample) {
    const category = r.expectedSafetyReason ?? 'allow';
    let stat = byCategory.get(category);
    if (!stat) {
      stat = { category, total: 0, expectedFilter: 0, actualFilter: 0, missed: 0, falsePositive: 0 };
      byCategory.set(category, stat);
    }
    stat.total++;
    if (r.expectedSafetyAction === 'filter') {
      stat.expectedFilter++;
      if (r.decision.allow) {
        stat.missed++;
      }
    } else if (!r.decision.allow) {
      stat.falsePositive++;
    }
    if (!r.decision.allow) {
      stat.actualFilter++;
    }
    if (r.passed) {
      passed++;
    } else if (r.failure === 'miss') {
      missed++;
    } else if (r.failure === 'false_positive') {
      falsePositive++;
    } else if (r.failure === 'wrong_reason') {
      wrongReason++;
    }
  }
  return {
    total: perSample.length,
    passed,
    missed,
    falsePositive,
    wrongReason,
    byCategory: [...byCategory.values()],
    perSample,
  };
}

// Runs the input safety filter over every sample with the given compiled rules.
export function runSafetyBenchmark(
  samples: BenchmarkSample[],
  compiledRules: CompiledSafetyRuleV1[],
): SafetyBenchmarkResult {
  return aggregateSafety(samples.map((sample) => evaluateSafetySample(sample, compiledRules)));
}

export interface FailClosedSampleResult {
  caseId: string;
  closed: boolean;
}

export interface FailClosedResult {
  total: number;
  passed: number;
  failed: number;
  perSample: FailClosedSampleResult[];
}

// Fail-closed invariant: with a missing policy the engine must reject every
// sample as SAFETY_ENGINE_ERROR, never silently allow (POC template §3).
export function runFailClosedCheck(samples: BenchmarkSample[]): FailClosedResult {
  const perSample = samples.map((sample) => {
    const decision = evaluateInputSafety({ normalizedText: normalizeComment(sample.text), compiledRules: null });
    return { caseId: sample.caseId, closed: !decision.allow && decision.reason === 'SAFETY_ENGINE_ERROR' };
  });
  const passed = perSample.filter((r) => r.closed).length;
  return { total: perSample.length, passed, failed: perSample.length - passed, perSample };
}
