import { describe, expect, it } from 'vitest';
import { normalizeHits } from '../../src/main/retrieval/index.js';
import { FIXTURES, loadJsonFixture } from '../fixtures/loader.js';

interface RawPoint {
  id: string;
  score: number;
  payload: Record<string, unknown> | null;
}

interface QdrantQueryFixture {
  version: string;
  description: string;
  rawPoints: RawPoint[];
}

const fixture = loadJsonFixture<QdrantQueryFixture>(FIXTURES.QDRANT_QUERY);

describe('T-RET-001 qdrant query fixture normalization', () => {
  it('normalizes raw points into pre_set hits with deterministic rank', () => {
    const hits = normalizeHits(fixture.rawPoints, 'pre_set');
    expect(hits).toHaveLength(fixture.rawPoints.length);
    expect(hits[0]).toMatchObject({
      collection: 'pre_set',
      rank: 1,
      caseId: 'pre-000001',
      rawScore: 12.5,
      pointId: fixture.rawPoints[0].id,
    });
    expect(hits[1]).toMatchObject({ collection: 'pre_set', rank: 2, caseId: 'pre-000002' });
  });

  it('preserves the payload for downstream classification', () => {
    const hits = normalizeHits(fixture.rawPoints, 'pre_set');
    expect(hits[0].payload).toMatchObject({ semantic_type: 'positive_praise', enabled: true });
  });
});
