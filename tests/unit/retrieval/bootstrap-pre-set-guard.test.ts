import { describe, expect, it } from 'vitest';
import {
  QDRANT_ALIAS_GOLDEN_SET,
  QDRANT_ALIAS_PRE_SET,
  bootstrapPreSet,
} from '../../../src/main/retrieval/index.js';

const VALID_CONTENT = [
  '{"schema_version":"1.0","id":"pre-000001","text":"今天状态真好","semantic_type":"positive_praise","description":"夸赞","enabled":true,"is_bad_case":false}',
  '{"schema_version":"1.0","id":"pre-000002","text":"这反应太快了，笑死我了","semantic_type":"funny_joke","description":"玩笑","enabled":true,"is_bad_case":false}',
].join('\n');

interface FakeClient {
  collections: Set<string>;
  created: string[];
  deleted: string[];
  aliases: Map<string, string>;
}

function makeClient(opts: { goldenAliasExists: boolean; existingGoldenCollection?: string; failUpsert?: boolean }): FakeClient & Record<string, unknown> {
  const state: FakeClient = {
    collections: new Set(),
    created: [],
    deleted: [],
    aliases: new Map(),
  };
  if (opts.goldenAliasExists) {
    const golden = opts.existingGoldenCollection ?? `${QDRANT_ALIAS_GOLDEN_SET}__existing`;
    state.collections.add(golden);
    state.aliases.set(QDRANT_ALIAS_GOLDEN_SET, golden);
  }
  const pointCounts = new Map<string, number>();
  return {
    ...state,
    pointCounts,
    getAliases: async () => ({
      aliases: [...state.aliases].map(([alias_name, collection_name]) => ({ alias_name, collection_name })),
    }),
    createCollection: async (name: string) => {
      state.collections.add(name);
      state.created.push(name);
    },
    createPayloadIndex: async () => {},
    upsert: async (name: string, body: { points?: unknown[] }) => {
      if (opts.failUpsert) throw new Error('qdrant upsert failed');
      pointCounts.set(name, body.points?.length ?? 0);
    },
    getCollection: async (name: string) => ({ points_count: pointCounts.get(name) ?? 0 }),
    query: async () => ({ points: [{ id: 'hit' }] }),
    updateCollectionAliases: async ({ actions }: { actions: Array<{ create_alias?: { collection_name: string; alias_name: string }; delete_alias?: { alias_name: string } }> }) => {
      for (const action of actions) {
        if (action.delete_alias) state.aliases.delete(action.delete_alias.alias_name);
        if (action.create_alias) state.aliases.set(action.create_alias.alias_name, action.create_alias.collection_name);
      }
    },
    deleteCollection: async (name: string) => {
      state.collections.delete(name);
      state.deleted.push(name);
      pointCounts.delete(name);
    },
  };
}

describe('bootstrapPreSet golden_set guard (WP-8)', () => {
  it('first bootstrap creates both collections and aliases', async () => {
    const client = makeClient({ goldenAliasExists: false });
    const profile = await bootstrapPreSet(client as never, { content: VALID_CONTENT });

    const preSet = `${QDRANT_ALIAS_PRE_SET}__${profile.profileId}`;
    const golden = `${QDRANT_ALIAS_GOLDEN_SET}__${profile.profileId}`;
    expect(client.collections.has(preSet)).toBe(true);
    expect(client.collections.has(golden)).toBe(true);
    expect(client.aliases.get(QDRANT_ALIAS_PRE_SET)).toBe(preSet);
    expect(client.aliases.get(QDRANT_ALIAS_GOLDEN_SET)).toBe(golden);
    expect(client.deleted).toEqual([]);
  });

  it('re-import only rebuilds pre_set and never touches the existing golden alias', async () => {
    const client = makeClient({ goldenAliasExists: true, existingGoldenCollection: 'golden_set__keep' });
    const profile = await bootstrapPreSet(client as never, { content: VALID_CONTENT });

    const preSet = `${QDRANT_ALIAS_PRE_SET}__${profile.profileId}`;
    expect(client.aliases.get(QDRANT_ALIAS_PRE_SET)).toBe(preSet);
    expect(client.aliases.get(QDRANT_ALIAS_GOLDEN_SET)).toBe('golden_set__keep');
    // Only the new pre_set collection was created; the golden one is untouched.
    expect(client.created).toEqual([preSet]);
    expect(client.collections.has('golden_set__keep')).toBe(true);
  });

  it('rolls back only this run\'s collections on failure, preserving the existing golden data', async () => {
    const client = makeClient({ goldenAliasExists: true, existingGoldenCollection: 'golden_set__keep', failUpsert: true });
    await expect(bootstrapPreSet(client as never, { content: VALID_CONTENT })).rejects.toThrow();

    // The failed run created (then deleted) only its own pre_set collection.
    expect(client.deleted).toHaveLength(1);
    expect(client.deleted[0]).toMatch(new RegExp(`^${QDRANT_ALIAS_PRE_SET}__`));
    expect(client.collections.has('golden_set__keep')).toBe(true);
    expect(client.aliases.get(QDRANT_ALIAS_GOLDEN_SET)).toBe('golden_set__keep');
  });
});
