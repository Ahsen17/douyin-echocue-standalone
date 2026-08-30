import type { RiskFilterTypeV1 } from '@echocue/contracts';
import { normalizeComment } from './Normalizer.js';

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
    // Align keywords to the same canonical form danmaku/import text is
    // normalized into, so a whole-copy keyword matches. A keyword that
    // normalizes to empty (e.g. a bare [表情] placeholder) would match every
    // haystack via includes('') — drop it instead.
    terms: type.keywords.map((keyword) => normalizeComment(keyword)).filter((term) => term.length > 0),
  }));
}

export interface ConfiguredRiskHit {
  typeId: string;
  label: string;
  term: string;
}

// First type, first matching keyword wins; keyword order within a type is kept.
// The haystack is run through normalizeComment (idempotent) so the output path,
// which passes raw NFKC-trimmed fields, lands in the same canonical form as the
// compiled keywords — symmetric matching across every path.
export function detectConfiguredRisk(
  compiled: CompiledRiskFilter,
  text: string,
): ConfiguredRiskHit | null {
  const haystack = normalizeComment(text);
  for (const type of compiled) {
    for (const term of type.terms) {
      if (haystack.includes(term)) {
        return { typeId: type.typeId, label: type.label, term };
      }
    }
  }
  return null;
}
