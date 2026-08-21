import type { AliasKind } from './types.js';

// Only a unique, high-confidence fuzzy match is accepted; everything else is
// conservatively routed to the principal (REQ §7.3, FR-03).
export const FUZZY_MATCH_THRESHOLD = 0.8;

export interface AliasRoutingData {
  aliasText: string;
  aliasKind: AliasKind;
  enabled: boolean;
}

export interface PersonaRoutingData {
  personaId: string;
  displayName: string;
  isPrincipal: boolean;
  aliases: AliasRoutingData[];
}

// matchedAlias is the display name or alias text that hit; score is 1 for an
// exact hit and [0, 1] for a fuzzy hit, kept for audit.
export interface RouteCandidate {
  personaId: string;
  matchedAlias: string;
  score: number;
}

export type PersonaRouteDecision = 'exact' | 'fuzzy_unique' | 'principal_fallback';

export interface RouteDecision {
  decision: PersonaRouteDecision;
  personaId: string;
  candidates: RouteCandidate[];
}

export class PersonaRouterUnavailableError extends Error {
  readonly code = 'E_PERSONA_ROUTE_UNAVAILABLE';
  constructor(msg: string) {
    super(msg);
    this.name = 'PersonaRouterUnavailableError';
  }
}

function collectMatchTexts(persona: PersonaRoutingData): string[] {
  const texts = new Set<string>();
  const displayName = persona.displayName.trim();
  if (displayName) {
    texts.add(displayName);
  }
  for (const a of persona.aliases) {
    const text = a.aliasText.trim();
    if (a.enabled && text) {
      texts.add(text);
    }
  }
  return [...texts];
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) {
    return n;
  }
  if (n === 0) {
    return m;
  }
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) {
    return 1;
  }
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// Best Levenshtein similarity between the alias and any same-length (+/-1)
// contiguous window of the text; windows are used because short Chinese names
// have no reliable word boundaries without a tokenizer.
function bestFuzzyScore(text: string, alias: string): number {
  const n = alias.length;
  let best = 0;
  for (let winLen = Math.max(1, n - 1); winLen <= n + 1; winLen++) {
    if (winLen > text.length) {
      continue;
    }
    for (let i = 0; i + winLen <= text.length; i++) {
      const s = similarity(alias, text.slice(i, i + winLen));
      if (s > best) {
        best = s;
      }
    }
  }
  return best;
}

// Exact stage keeps the longest alias hit per persona; multiple personas in
// the same message are ambiguous and route to the principal.
function exactCandidates(normalizedText: string, personas: PersonaRoutingData[]): RouteCandidate[] {
  const found: RouteCandidate[] = [];
  for (const persona of personas) {
    let best: RouteCandidate | null = null;
    for (const text of collectMatchTexts(persona)) {
      if (normalizedText.includes(text) && (best === null || text.length > best.matchedAlias.length)) {
        best = { personaId: persona.personaId, matchedAlias: text, score: 1 };
      }
    }
    if (best !== null) {
      found.push(best);
    }
  }
  return found;
}

function fuzzyCandidates(normalizedText: string, personas: PersonaRoutingData[]): RouteCandidate[] {
  const found: RouteCandidate[] = [];
  for (const persona of personas) {
    let best: RouteCandidate | null = null;
    for (const text of collectMatchTexts(persona)) {
      const score = bestFuzzyScore(normalizedText, text);
      if (score >= FUZZY_MATCH_THRESHOLD && (best === null || score > best.score)) {
        best = { personaId: persona.personaId, matchedAlias: text, score };
      }
    }
    if (best !== null) {
      found.push(best);
    }
  }
  return found;
}

// Deterministic member routing over normalized text. Exact hit wins; a single
// high-confidence unique fuzzy hit is accepted; anything ambiguous, low
// confidence, or unnamed falls back to the principal persona.
export function routePersona(normalizedText: string, personas: PersonaRoutingData[]): RouteDecision {
  const principal = personas.find((p) => p.isPrincipal);
  if (!principal) {
    throw new PersonaRouterUnavailableError('No principal persona configured for routing');
  }
  const principalId = principal.personaId;

  const exact = exactCandidates(normalizedText, personas);
  if (exact.length === 1) {
    return { decision: 'exact', personaId: exact[0].personaId, candidates: exact };
  }
  if (exact.length > 1) {
    return { decision: 'principal_fallback', personaId: principalId, candidates: exact };
  }

  const fuzzy = fuzzyCandidates(normalizedText, personas);
  if (fuzzy.length === 1) {
    return { decision: 'fuzzy_unique', personaId: fuzzy[0].personaId, candidates: fuzzy };
  }
  return { decision: 'principal_fallback', personaId: principalId, candidates: fuzzy };
}
