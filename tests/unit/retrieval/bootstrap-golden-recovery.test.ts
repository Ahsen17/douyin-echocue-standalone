import { describe, expect, it } from 'vitest';
import { BM25_TOKENIZER_VERSION_V1 } from '@echocue/contracts';
import {
  QDRANT_ALIAS_GOLDEN_SET,
  QDRANT_ALIAS_PRE_SET,
  bootstrapPreSet,
} from '../../../src/main/retrieval/index.js';
import { uuidv7 } from '../../../src/main/util/index.js';

const VALID_CONTENT = [
  '{"schema_version":"1.0","id":"pre-000001","text":"今天状态真好","semantic_type":"positive_praise","description":"夸赞","enabled":true,"is_bad_case":false}',
].join('\n');

interface FakeState {
  collections: Set<string>;
  aliases: Map<string, string>;
  aliasSwitchDone: boolean;
}

function makeClient(opts: {
  orphanGoldenCollection?: { name: string; tokenizerVersion: string; points: number };
  /** Fails every golden-target upsert after the alias switch (replay path). */
  failReplayUpsert?: boolean;
}) {
  const state: FakeState = {
    collections: new Set(),
    aliases: new Map(),
    aliasSwitchDone: false,
  };
  const pointCounts = new Map<string, number>();
  const upserts = new Map<string, number>();
  if (opts.orphanGoldenCollection) {
    state.collections.add(opts.orphanGoldenCollection.name);
    pointCounts.set(opts.orphanGoldenCollection.name, opts.orphanGoldenCollection.points);
  }
  return {
    state,
    upserts,
    getAliases: async () => ({
      aliases: [...state.aliases].map(([alias_name, collection_name]) => ({ alias_name, collection_name })),
    }),
    getCollections: async () => ({
      collections: [...state.collections].map((name) => ({ name })),
    }),
    createCollection: async (name: string) => {
      state.collections.add(name);
    },
    createPayloadIndex: async () => {},
    upsert: async (name: string, body: { points?: unknown[] }) => {
      const isGoldenTarget = name.startsWith(`${QDRANT_ALIAS_GOLDEN_SET}__`);
      if (opts.failReplayUpsert && state.aliasSwitchDone && isGoldenTarget) {
        throw new Error('replay upsert failed');
      }
      pointCounts.set(name, (pointCounts.get(name) ?? 0) + (body.points?.length ?? 0));
      upserts.set(name, (upserts.get(name) ?? 0) + 1);
    },
    getCollection: async (name: string) => ({
      points_count: pointCounts.get(name) ?? 0,
      config: {
        metadata: {
          tokenizer_version:
            name === opts.orphanGoldenCollection?.name
              ? opts.orphanGoldenCollection.tokenizerVersion
              : BM25_TOKENIZER_VERSION_V1,
          normalization_version: 'zh_bm25_normalize_v1',
        },
      },
    }),
    query: async () => ({ points: [{ id: 'hit' }] }),
    scroll: async () => ({
      points: [
        {
          id: '01932a3b-4c5d-7000-8000-000000000001',
          payload: {
            case_id: 'g-orphan',
            tokenizer_version: opts.orphanGoldenCollection?.tokenizerVersion,
            source_trace_id: uuidv7(),
            persona_id: 'p-1',
            persona_version: uuidv7(),
            text: '主播认可的好答案',
            semantic_type: 'positive_praise',
            reply: '谢谢你',
            cues: ['接住夸奖', '继续互动'],
            quality_score: 90,
            enabled: true,
            is_bad_case: false,
            created_at: '2026-09-29T00:00:00.000Z',
            updated_at: '2026-09-29T00:00:00.000Z',
          },
        },
      ],
      next_page_offset: null,
    }),
    updateCollectionAliases: async ({ actions }: { actions: Array<{ create_alias?: { collection_name: string; alias_name: string }; delete_alias?: { alias_name: string } }> }) => {
      for (const action of actions) {
        if (action.delete_alias) state.aliases.delete(action.delete_alias.alias_name);
        if (action.create_alias) state.aliases.set(action.create_alias.alias_name, action.create_alias.collection_name);
      }
      state.aliasSwitchDone = true;
    },
    deleteCollection: async (name: string) => {
      state.collections.delete(name);
      pointCounts.delete(name);
    },
  } as never as import('@qdrant/js-client-rest').QdrantClient;
}

describe('bootstrapPreSet golden orphan adoption (S-1)', () => {
  it('adopts a version-compatible orphan golden collection instead of creating an empty one', async () => {
    const client = makeClient({
      orphanGoldenCollection: { name: `${QDRANT_ALIAS_GOLDEN_SET}__orphan`, tokenizerVersion: BM25_TOKENIZER_VERSION_V1, points: 3 },
    });

    await bootstrapPreSet(client, { content: VALID_CONTENT });

    // The alias points at the orphan's data, not a fresh empty collection.
    expect(client.state.aliases.get(QDRANT_ALIAS_GOLDEN_SET)).toBe(`${QDRANT_ALIAS_GOLDEN_SET}__orphan`);
    expect(client.state.collections.has(`${QDRANT_ALIAS_GOLDEN_SET}__orphan`)).toBe(true);
    // Exactly one new collection (pre_set) was created.
    const created = [...client.state.collections].filter((n) => n.startsWith('pre_set__'));
    expect(created).toHaveLength(1);
  });

  it('migrates a stale orphan golden collection and retires it only after a clean replay', async () => {
    const client = makeClient({
      orphanGoldenCollection: { name: `${QDRANT_ALIAS_GOLDEN_SET}__orphan`, tokenizerVersion: 'zh_jieba_search_v1', points: 2 },
    });

    await bootstrapPreSet(client, { content: VALID_CONTENT });

    const goldenAlias = client.state.aliases.get(QDRANT_ALIAS_GOLDEN_SET)!;
    expect(goldenAlias).toMatch(new RegExp(`^${QDRANT_ALIAS_GOLDEN_SET}__`));
    expect(goldenAlias).not.toBe(`${QDRANT_ALIAS_GOLDEN_SET}__orphan`);
    // A clean replay retires the stale orphan.
    expect(client.state.collections.has(`${QDRANT_ALIAS_GOLDEN_SET}__orphan`)).toBe(false);
  });

  it('keeps the stale orphan as a backup when the post-switch replay fails', async () => {
    const client = makeClient({
      orphanGoldenCollection: { name: `${QDRANT_ALIAS_GOLDEN_SET}__orphan`, tokenizerVersion: 'zh_jieba_search_v1', points: 2 },
      failReplayUpsert: true,
    });

    await bootstrapPreSet(client, { content: VALID_CONTENT });

    // Migration is committed (alias switched to the new collection)…
    const goldenAlias = client.state.aliases.get(QDRANT_ALIAS_GOLDEN_SET)!;
    expect(goldenAlias).toMatch(new RegExp(`^${QDRANT_ALIAS_GOLDEN_SET}__`));
    expect(goldenAlias).not.toBe(`${QDRANT_ALIAS_GOLDEN_SET}__orphan`);
    // …but the orphan with the un-replayed points is retained, not deleted.
    expect(client.state.collections.has(`${QDRANT_ALIAS_GOLDEN_SET}__orphan`)).toBe(true);
  });
});
