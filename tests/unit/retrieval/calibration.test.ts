import { describe, expect, it } from 'vitest';
import type { RetrievalRawHit } from '../../../src/main/retrieval/index.js';
import {
  DEFAULT_CALIBRATION_ARTIFACT_V1,
  calibrateHits,
  calibrateScore,
  validateCalibrationArtifact,
} from '../../../src/main/retrieval/index.js';
import type { CalibrationArtifactV1 } from '../../../src/main/retrieval/index.js';

describe('calibrateScore', () => {
  const artifact: CalibrationArtifactV1 = {
    artifactId: 'test',
    version: 'v1',
    preSet: { center: 0, scale: 2 },
    goldenSet: { center: 4, scale: 1 },
    semanticDiscardConfidence: 0.9,
  };

  it('maps scores into [0,1] (contract bound), strictly interior for moderate values', () => {
    for (const raw of [-1e6, -100, -1, 0, 0.5, 3.2, 12.5, 1e6]) {
      const conf = calibrateScore(raw, 'pre_set', artifact);
      expect(conf).toBeGreaterThanOrEqual(0);
      expect(conf).toBeLessThanOrEqual(1);
    }
    expect(calibrateScore(-1e6, 'pre_set', artifact)).toBe(0);
    expect(calibrateScore(1e6, 'pre_set', artifact)).toBe(1);
    expect(calibrateScore(0, 'pre_set', artifact)).toBeGreaterThan(0);
    expect(calibrateScore(0, 'pre_set', artifact)).toBeLessThan(1);
  });

  it('is monotonic increasing in raw score', () => {
    let prev = calibrateScore(-10, 'pre_set', artifact);
    for (let raw = -9; raw <= 10; raw += 1) {
      const conf = calibrateScore(raw, 'pre_set', artifact);
      expect(conf).toBeGreaterThanOrEqual(prev);
      prev = conf;
    }
  });

  it('is deterministic for the same input', () => {
    expect(calibrateScore(3.2, 'golden_set', artifact)).toBe(
      calibrateScore(3.2, 'golden_set', artifact),
    );
  });

  it('uses per-collection parameters so raw scores are not cross-compared directly', () => {
    const pre = calibrateScore(3.2, 'pre_set', artifact);
    const golden = calibrateScore(3.2, 'golden_set', artifact);
    expect(pre).not.toBe(golden);
    // golden center is 4 → raw 3.2 sits below center → conf < 0.5
    expect(golden).toBeLessThan(0.5);
  });

  it('rejects an invalid artifact before scoring', () => {
    const bad = { ...artifact, preSet: { center: 0, scale: 0 } };
    expect(() => calibrateScore(1, 'pre_set', bad)).toThrow(/scale must be positive/);
  });
});

describe('validateCalibrationArtifact', () => {
  it('accepts the default artifact', () => {
    expect(() => validateCalibrationArtifact(DEFAULT_CALIBRATION_ARTIFACT_V1)).not.toThrow();
  });

  it('rejects non-positive scale', () => {
    expect(() =>
      validateCalibrationArtifact({
        ...DEFAULT_CALIBRATION_ARTIFACT_V1,
        goldenSet: { center: 0, scale: -1 },
      }),
    ).toThrow(/scale must be positive/);
  });

  it('rejects non-finite center/scale', () => {
    expect(() =>
      validateCalibrationArtifact({
        ...DEFAULT_CALIBRATION_ARTIFACT_V1,
        preSet: { center: 0, scale: Number.POSITIVE_INFINITY },
      }),
    ).toThrow(/must be finite/);
    expect(() =>
      validateCalibrationArtifact({
        ...DEFAULT_CALIBRATION_ARTIFACT_V1,
        goldenSet: { center: Number.NaN, scale: 2 },
      }),
    ).toThrow(/must be finite/);
  });

  it('rejects discard confidence out of [0,1]', () => {
    expect(() =>
      validateCalibrationArtifact({ ...DEFAULT_CALIBRATION_ARTIFACT_V1, semanticDiscardConfidence: 1.1 }),
    ).toThrow(/out of range/);
  });

  it('rejects empty version or artifact id', () => {
    expect(() => validateCalibrationArtifact({ ...DEFAULT_CALIBRATION_ARTIFACT_V1, version: '  ' })).toThrow(
      /must not be empty/,
    );
  });
});

function rawHit(overrides: Partial<RetrievalRawHit>): RetrievalRawHit {
  return {
    pointId: 'p-1',
    caseId: 'c-1',
    collection: 'pre_set',
    rawScore: 5,
    rank: 1,
    payload: {
      schema_version: '1.0',
      case_id: 'c-1',
      tokenizer_version: 'zh_jieba_search_v1',
      text: '今天状态真好',
      semantic_type: 'positive_praise',
      description: '夸赞',
      enabled: true,
      is_bad_case: false,
    },
    ...overrides,
  };
}

describe('calibrateHits', () => {
  it('adds retrievalConfidence while preserving rank and payload', () => {
    const hit = rawHit({ pointId: 'g-1', rawScore: 12.5, rank: 2 });
    const [calibrated] = calibrateHits([hit], 'pre_set', DEFAULT_CALIBRATION_ARTIFACT_V1);
    expect(calibrated).toMatchObject({
      pointId: 'g-1',
      rank: 2,
      collection: 'pre_set',
      rawScore: 12.5,
    });
    expect(calibrated.retrievalConfidence).toBeGreaterThan(0.5);
    expect(calibrated.retrievalConfidence).toBeLessThan(1);
  });

  it('normalizes empty hits to empty', () => {
    expect(calibrateHits([], 'golden_set', DEFAULT_CALIBRATION_ARTIFACT_V1)).toEqual([]);
  });

  it('throws for an unknown collection value', () => {
    expect(() =>
      calibrateHits([rawHit({})], 'other' as 'pre_set', DEFAULT_CALIBRATION_ARTIFACT_V1),
    ).toThrow();
  });
});
