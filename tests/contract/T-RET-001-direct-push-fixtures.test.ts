import { describe, expect, it } from 'vitest';
import type { RetrievalHitV1 } from '@echocue/contracts';
import { RetrievalHitV1Schema } from '@echocue/contracts';
import { evaluateDirectPush } from '../../src/main/retrieval/index.js';
import { FIXTURES, loadJsonFixture } from '../fixtures/loader.js';
import type { DirectPushContext } from '../../src/main/retrieval/index.js';

interface ScenarioHitJson {
  pointId: string;
  caseId: string;
  collection: 'pre_set' | 'golden_set';
  rawScore: number;
  retrievalConfidence: number;
  rank: number;
  payloadRef: string;
}

interface DirectPushScenario {
  name: string;
  topK: ScenarioHitJson[];
  expected: { eligible: boolean; pointId?: string; reason: string };
}

interface DirectPushFixture {
  version: string;
  context: DirectPushContext;
  goldenPayload: Record<string, unknown>;
  prePayload: Record<string, unknown>;
  scenarios: DirectPushScenario[];
}

const fixture = loadJsonFixture<DirectPushFixture>(FIXTURES.RETRIEVAL_DIRECT_PUSH);

function resolveScenarioHit(json: ScenarioHitJson): RetrievalHitV1 {
  const payloadRef = json.payloadRef === 'goldenPayload' ? fixture.goldenPayload : fixture.prePayload;
  return {
    pointId: json.pointId,
    caseId: json.caseId,
    collection: json.collection,
    rawScore: json.rawScore,
    retrievalConfidence: json.retrievalConfidence,
    rank: json.rank,
    payload: payloadRef as never,
  };
}

describe('T-RET-001 golden direct-push fixture', () => {
  it('matches every scenario decision against the frozen fixture', () => {
    for (const scenario of fixture.scenarios) {
      const hits = scenario.topK.map(resolveScenarioHit);
      const decision = evaluateDirectPush(hits, fixture.context);
      expect(
        decision,
        `scenario: ${scenario.name}`,
      ).toEqual({
        eligible: scenario.expected.eligible,
        ...(scenario.expected.pointId !== undefined ? { pointId: scenario.expected.pointId } : {}),
        reason: scenario.expected.reason as 'GOLDEN_DIRECT_ELIGIBLE' | 'LLM_REQUIRED',
      });
    }
  });

  it('validates every scenario hit against RetrievalHitV1Schema', () => {
    for (const scenario of fixture.scenarios) {
      for (const json of scenario.topK) {
        const hit = resolveScenarioHit(json);
        expect(RetrievalHitV1Schema.safeParse(hit).success, `scenario: ${scenario.name}`).toBe(true);
      }
    }
  });

  it('validates the golden payload reference independently', () => {
    expect(RetrievalHitV1Schema.safeParse(resolveScenarioHit(fixture.scenarios[0].topK[0])).success).toBe(true);
  });
});
