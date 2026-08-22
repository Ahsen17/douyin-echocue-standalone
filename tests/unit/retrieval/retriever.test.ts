import { describe, expect, it } from 'vitest';
import type { QdrantClient } from '@qdrant/js-client-rest';
import {
  SuggestionRetriever,
  normalizeHits,
} from '../../../src/main/retrieval/index.js';

describe('normalizeHits', () => {
  it('maps raw points to hits with rank, source, and case id', () => {
    const hits = normalizeHits(
      [
        { id: 'a1', score: 12.5, payload: { case_id: 'pre-000001' } },
        { id: 'a2', score: 3.2, payload: { case_id: 'pre-000002' } },
      ],
      'pre_set',
    );
    expect(hits[0]).toMatchObject({
      pointId: 'a1',
      caseId: 'pre-000001',
      collection: 'pre_set',
      rawScore: 12.5,
      rank: 1,
    });
    expect(hits[1].rank).toBe(2);
    expect(hits[1].rawScore).toBe(3.2);
  });

  it('defaults missing score and case id', () => {
    const hits = normalizeHits([{ id: 'x', payload: null }], 'golden_set');
    expect(hits[0]).toMatchObject({ rawScore: 0, caseId: '' });
  });

  it('stringifies numeric point ids', () => {
    const hits = normalizeHits([{ id: 42, score: 1, payload: { case_id: 'pre-9' } }], 'pre_set');
    expect(hits[0].pointId).toBe('42');
  });
});

function mockClient(queryImpl: (collection: string, options: unknown) => Promise<unknown>) {
  return { query: queryImpl } as unknown as QdrantClient;
}

describe('SuggestionRetriever', () => {
  it('queries both collections with deduped sparse terms and the pre_set filter', async () => {
    const calls: Array<{ collection: string; options: any }> = [];
    const client = mockClient(async (collection, options) => {
      calls.push({ collection, options });
      return { points: [] };
    });
    const retriever = new SuggestionRetriever(client);

    const result = await retriever.search({ queryText: '主播 主播 状态' });

    expect(calls).toHaveLength(2);
    const preCall = calls.find((c) => c.collection === 'pre_set')!;
    const goldenCall = calls.find((c) => c.collection === 'golden_set')!;
    expect(preCall.options.using).toBe('bm25_zh_jieba_v1');
    expect(preCall.options.query.indices).toHaveLength(2); // 主播/状态 deduped
    expect(preCall.options.query.values).toEqual([1, 1]);
    expect(preCall.options.filter.must).toEqual([
      { key: 'enabled', match: { value: true } },
      { key: 'is_bad_case', match: { value: false } },
    ]);
    expect(goldenCall.options.filter.must).toHaveLength(2);
    expect(result.preHits).toEqual([]);
    expect(result.goldenHits).toEqual([]);
  });

  it('adds persona filters to the golden_set query when provided', async () => {
    let goldenFilter: any;
    const client = mockClient(async (collection, options) => {
      if (collection === 'golden_set') goldenFilter = (options as any).filter;
      return { points: [] };
    });
    const retriever = new SuggestionRetriever(client);

    await retriever.search({ queryText: '状态', personaId: 'p-1', personaVersion: 'v-1' });

    expect(goldenFilter.must).toEqual([
      { key: 'enabled', match: { value: true } },
      { key: 'is_bad_case', match: { value: false } },
      { key: 'persona_id', match: { value: 'p-1' } },
      { key: 'persona_version', match: { value: 'v-1' } },
    ]);
  });

  it('rejects a partial persona pair instead of silently dropping the filters', async () => {
    const client = mockClient(async () => ({ points: [] }));
    const retriever = new SuggestionRetriever(client);
    await expect(retriever.search({ queryText: '状态', personaId: 'p-1' })).rejects.toThrow(
      /must be provided together/,
    );
  });

  it('short-circuits on empty query tokens', async () => {
    let queried = false;
    const client = mockClient(async () => {
      queried = true;
      return { points: [] };
    });
    const retriever = new SuggestionRetriever(client);
    const result = await retriever.search({ queryText: '。！？' });
    expect(result).toEqual({ preHits: [], goldenHits: [] });
    expect(queried).toBe(false);
  });

  it('clamps topK to at least one', async () => {
    let topKUsed = 0;
    const client = mockClient(async (_collection, options) => {
      topKUsed = Math.max(topKUsed, (options as any).limit);
      return { points: [] };
    });
    const retriever = new SuggestionRetriever(client);
    await retriever.search({ queryText: '状态', topK: 0 });
    expect(topKUsed).toBe(1);
  });

  it('normalizes hits per source collection and honors topK', async () => {
    const client = mockClient(async () => ({
      points: [
        { id: 'g1', score: 9.5, payload: { case_id: 'gc-1' } },
        { id: 'g2', score: 8.0, payload: { case_id: 'gc-2' } },
      ],
    }));
    const retriever = new SuggestionRetriever(client);

    const result = await retriever.search({ queryText: '状态', topK: 2 });

    expect(result.goldenHits).toHaveLength(2);
    expect(result.goldenHits[0]).toMatchObject({ collection: 'golden_set', rank: 1, rawScore: 9.5 });
    expect(result.preHits).toHaveLength(2);
  });
});
