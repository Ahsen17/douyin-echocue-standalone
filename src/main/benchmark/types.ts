import type { SafetyReasonCodeV1 } from '@echocue/contracts';
import type { PersonaRouteDecision } from '../persona/router.js';

export type ExpectedSafetyAction = 'allow' | 'filter';

// Route scenarios follow the FR-03 acceptance matrix; 'safety' marks samples
// that only exercise the input filter (no member routing expectation).
export type RouteScenario =
  | 'exact'
  | 'typo_variant'
  | 'unnamed'
  | 'ambiguous'
  | 'low_confidence'
  | 'fuzzy_unique'
  | 'safety';

// Machine-readable benchmark sample per the safety/routing POC template §2.
export interface BenchmarkSample {
  caseId: string;
  text: string;
  expectedSafetyAction: ExpectedSafetyAction;
  expectedSafetyReason: SafetyReasonCodeV1 | null;
  mentionedPersonaId: string | null;
  expectedPersonaId: string | null;
  expectedRouteDecision?: PersonaRouteDecision;
  expectedSemanticType?: string;
  scenario: RouteScenario;
  notes?: string;
}

export interface BenchmarkDataset {
  schemaVersion: 1;
  datasetId: string;
  createdAt: string;
  note?: string;
  samples: BenchmarkSample[];
}
