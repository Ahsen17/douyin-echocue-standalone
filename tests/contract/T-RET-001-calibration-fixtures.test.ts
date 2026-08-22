import { describe, expect, it } from 'vitest';
import {
  RetrievalHitV1Schema,
  SourceCollectionV1Schema,
} from '@echocue/contracts';
import {
  calibrateScore,
  evaluateRetrieval,
} from '../../src/main/retrieval/index.js';
import { FIXTURES, loadJsonFixture } from '../fixtures/loader.js';
import type { CalibrationArtifactV1, RetrievalRawHit } from '../../src/main/retrieval/index.js';

interface RawHitJson {
  pointId: string;
  caseId: string;
  collection: 'pre_set' | 'golden_set';
  rawScore: number;
  rank: number;
  payload: Record<string, unknown>;
}

interface CalibrationFixture {
  version: string;
  artifact: CalibrationArtifactV1;
  rawHits: { preHits: RawHitJson[]; goldenHits: RawHitJson[] };
  expected: {
    preConfidenceFirst: number;
    goldenConfidenceFirst: number;
    preConfidenceSecond: number;
    mergedTopKOrder: string[];
    semanticAction: 'DISCARD' | 'CANDIDATE';
    semanticTopType: string;
  };
}

const fixture = loadJsonFixture<CalibrationFixture>(FIXTURES.RETRIEVAL_CALIBRATION);

function toRawHit(json: RawHitJson): RetrievalRawHit {
  return {
    pointId: json.pointId,
    caseId: json.caseId,
    collection: json.collection,
    rawScore: json.rawScore,
    rank: json.rank,
    payload: json.payload as never,
  };
}

describe('T-RET-001 retrieval calibration fixture', () => {
  it('matches the frozen sigmoid calibration reference', () => {
    expect(calibrateScore(12.5, 'pre_set', fixture.artifact)).toBe(fixture.expected.preConfidenceFirst);
    expect(calibrateScore(9.5, 'golden_set', fixture.artifact)).toBe(fixture.expected.goldenConfidenceFirst);
    expect(calibrateScore(3.2, 'pre_set', fixture.artifact)).toBe(fixture.expected.preConfidenceSecond);
  });

  it('produces the expected mergedTopK order and semantic decision', () => {
    const raw = {
      preHits: fixture.rawHits.preHits.map(toRawHit),
      goldenHits: fixture.rawHits.goldenHits.map(toRawHit),
    };
    const result = evaluateRetrieval(raw, { artifact: fixture.artifact });
    expect(result.mergedTopK.map((h) => h.pointId)).toEqual(fixture.expected.mergedTopKOrder);
    expect(result.semanticDecision.action).toBe(fixture.expected.semanticAction);
    expect(result.semanticDecision.topSemanticType).toBe(fixture.expected.semanticTopType);
  });

  it('validates every calibrated hit against RetrievalHitV1Schema', () => {
    const raw = {
      preHits: fixture.rawHits.preHits.map(toRawHit),
      goldenHits: fixture.rawHits.goldenHits.map(toRawHit),
    };
    const result = evaluateRetrieval(raw, { artifact: fixture.artifact });
    for (const hit of [...result.preHits, ...result.goldenHits, ...result.mergedTopK]) {
      expect(RetrievalHitV1Schema.safeParse(hit).success).toBe(true);
    }
  });

  it('rejects an unknown collection value at the schema level', () => {
    expect(SourceCollectionV1Schema.safeParse('other').success).toBe(false);
    expect(SourceCollectionV1Schema.safeParse('pre_set').success).toBe(true);
  });
});
