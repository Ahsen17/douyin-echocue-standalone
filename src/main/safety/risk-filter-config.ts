import type { RiskFilterTypeV1 } from '@echocue/contracts';

// WP-10: user-configured risk-filter types. Compiled once per session (frozen),
// then matched by the input/output safety paths in configuration order.

/** A compiled risk type: ordered substring keywords, first hit wins. */
export interface CompiledRiskType {
  typeId: string;
  label: string;
  terms: readonly string[];
}

/** Compiled risk filter: types in configuration order. Empty ⇒ no filtering. */
export type CompiledRiskFilter = readonly CompiledRiskType[];

export function compileRiskFilter(types: readonly RiskFilterTypeV1[]): CompiledRiskFilter {
  return types.map((type) => ({
    typeId: type.typeId,
    label: type.label,
    terms: type.keywords,
  }));
}

export interface ConfiguredRiskHit {
  typeId: string;
  label: string;
  term: string;
}

// First type, first matching keyword wins; keyword order within a type is kept.
export function detectConfiguredRisk(
  compiled: CompiledRiskFilter,
  normalizedText: string,
): ConfiguredRiskHit | null {
  for (const type of compiled) {
    for (const term of type.terms) {
      if (normalizedText.includes(term)) {
        return { typeId: type.typeId, label: type.label, term };
      }
    }
  }
  return null;
}
