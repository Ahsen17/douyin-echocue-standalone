import type { PersonaRouteDecision, PersonaRoutingData, RouteDecision } from '../persona/router.js';
import { routePersona } from '../persona/index.js';
import { normalizeComment } from '../safety/index.js';
import type { BenchmarkSample, RouteScenario } from './types.js';

export interface RoutingSampleResult {
  caseId: string;
  scenario: RouteScenario;
  expectedPersonaId: string | null;
  expectedRouteDecision: PersonaRouteDecision | undefined;
  route: RouteDecision;
  passed: boolean;
}

export interface RouteScenarioStat {
  scenario: string;
  total: number;
  passed: number;
  conservative: number;
  wrong: number;
}

export interface RoutingBenchmarkResult {
  total: number;
  passed: number;
  wrong: number;
  byScenario: RouteScenarioStat[];
  perSample: RoutingSampleResult[];
}

// Only samples carrying a routing expectation participate; safety-only samples
// are out of scope for the routing table.
function routingSamples(samples: BenchmarkSample[]): BenchmarkSample[] {
  return samples.filter((s) => s.expectedPersonaId !== null);
}

export function runRoutingBenchmark(
  samples: BenchmarkSample[],
  personas: PersonaRoutingData[],
): RoutingBenchmarkResult {
  const targets = routingSamples(samples);
  const perSample = targets.map((sample) => {
    const route = routePersona(normalizeComment(sample.text), personas);
    const personaOk = route.personaId === sample.expectedPersonaId;
    const decisionOk =
      sample.expectedRouteDecision === undefined || route.decision === sample.expectedRouteDecision;
    return {
      caseId: sample.caseId,
      scenario: sample.scenario,
      expectedPersonaId: sample.expectedPersonaId,
      expectedRouteDecision: sample.expectedRouteDecision,
      route,
      passed: personaOk && decisionOk,
    };
  });

  const byScenario = new Map<string, RouteScenarioStat>();
  let passed = 0;
  for (const r of perSample) {
    let stat = byScenario.get(r.scenario);
    if (!stat) {
      stat = { scenario: r.scenario, total: 0, passed: 0, conservative: 0, wrong: 0 };
      byScenario.set(r.scenario, stat);
    }
    stat.total++;
    if (r.passed) {
      stat.passed++;
      // Any passed sample that was conservatively routed to the principal
      // counts as conservative handling (POC §4), not just the ambiguous one.
      if (r.route.decision === 'principal_fallback') {
        stat.conservative++;
      }
    } else {
      stat.wrong++;
    }
    if (r.passed) {
      passed++;
    }
  }

  return {
    total: perSample.length,
    passed,
    wrong: perSample.length - passed,
    byScenario: [...byScenario.values()],
    perSample,
  };
}
