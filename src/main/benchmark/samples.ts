import { createHash } from 'node:crypto';
import type { SafetyReasonCodeV1 } from '@echocue/contracts';
import type { BenchmarkDataset, BenchmarkSample, RouteScenario } from './types.js';

const SAFETY_REASONS: readonly SafetyReasonCodeV1[] = [
  'ABUSE', 'PII', 'POLITICS', 'SEXUAL', 'ILLEGAL',
  'MEDICAL_FINANCIAL_ADVICE', 'COMPETITOR', 'TRANSACTION_PRICE',
  'TEAM_FORBIDDEN', 'SAFETY_ENGINE_ERROR',
];
const ROUTE_DECISIONS: readonly string[] = ['exact', 'fuzzy_unique', 'principal_fallback'];
const SCENARIOS: readonly RouteScenario[] = [
  'exact', 'typo_variant', 'unnamed', 'ambiguous', 'low_confidence', 'fuzzy_unique', 'safety',
];

export class BenchmarkDatasetInvalidError extends Error {
  readonly code = 'E_BENCHMARK_DATASET_INVALID';
  constructor(msg: string) {
    super(msg);
    this.name = 'BenchmarkDatasetInvalidError';
  }
}

export function validateBenchmarkSamples(dataset: unknown): asserts dataset is BenchmarkDataset {
  if (typeof dataset !== 'object' || dataset === null) {
    throw new BenchmarkDatasetInvalidError('dataset must be an object');
  }
  const d = dataset as Record<string, unknown>;
  if (d.schemaVersion !== 1) {
    throw new BenchmarkDatasetInvalidError('schemaVersion must be 1');
  }
  if (typeof d.datasetId !== 'string' || d.datasetId.length === 0) {
    throw new BenchmarkDatasetInvalidError('datasetId must be a non-empty string');
  }
  if (!Array.isArray(d.samples) || d.samples.length === 0) {
    throw new BenchmarkDatasetInvalidError('samples must be a non-empty array');
  }
  const seen = new Set<string>();
  for (const sample of d.samples) {
    validateSample(sample, seen);
  }
}

function validateSample(sample: unknown, seen: Set<string>): asserts sample is BenchmarkSample {
  if (typeof sample !== 'object' || sample === null) {
    throw new BenchmarkDatasetInvalidError('each sample must be an object');
  }
  const s = sample as Record<string, unknown>;
  if (typeof s.caseId !== 'string' || s.caseId.length === 0) {
    throw new BenchmarkDatasetInvalidError('caseId must be a non-empty string');
  }
  if (seen.has(s.caseId)) {
    throw new BenchmarkDatasetInvalidError(`duplicate caseId: ${s.caseId}`);
  }
  seen.add(s.caseId);
  if (typeof s.text !== 'string') {
    throw new BenchmarkDatasetInvalidError(`case ${s.caseId}: text must be a string`);
  }
  if (s.expectedSafetyAction !== 'allow' && s.expectedSafetyAction !== 'filter') {
    throw new BenchmarkDatasetInvalidError(`case ${s.caseId}: invalid expectedSafetyAction`);
  }
  if (s.expectedSafetyReason !== null && !SAFETY_REASONS.includes(s.expectedSafetyReason as SafetyReasonCodeV1)) {
    throw new BenchmarkDatasetInvalidError(`case ${s.caseId}: invalid expectedSafetyReason`);
  }
  // A filter sample must name a reason; an allow sample must not, otherwise
  // the benchmark would silently produce misleading results.
  if (s.expectedSafetyAction === 'filter' && s.expectedSafetyReason === null) {
    throw new BenchmarkDatasetInvalidError(`case ${s.caseId}: filter samples require expectedSafetyReason`);
  }
  if (s.expectedSafetyAction === 'allow' && s.expectedSafetyReason !== null) {
    throw new BenchmarkDatasetInvalidError(`case ${s.caseId}: allow samples must have expectedSafetyReason null`);
  }
  if (s.mentionedPersonaId !== null && typeof s.mentionedPersonaId !== 'string') {
    throw new BenchmarkDatasetInvalidError(`case ${s.caseId}: mentionedPersonaId must be a string or null`);
  }
  if (s.expectedPersonaId !== null && typeof s.expectedPersonaId !== 'string') {
    throw new BenchmarkDatasetInvalidError(`case ${s.caseId}: expectedPersonaId must be a string or null`);
  }
  if (s.expectedRouteDecision !== undefined && !ROUTE_DECISIONS.includes(s.expectedRouteDecision as string)) {
    throw new BenchmarkDatasetInvalidError(`case ${s.caseId}: invalid expectedRouteDecision`);
  }
  if (!SCENARIOS.includes(s.scenario as RouteScenario)) {
    throw new BenchmarkDatasetInvalidError(`case ${s.caseId}: invalid scenario`);
  }
}

// Canonical, key-order-independent hash over samples for dataset versioning.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashDataset(dataset: BenchmarkDataset): string {
  return createHash('sha256').update(stableStringify(dataset.samples)).digest('hex');
}
