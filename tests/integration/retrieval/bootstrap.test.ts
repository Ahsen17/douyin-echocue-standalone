import { QdrantClient } from '@qdrant/js-client-rest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  QDRANT_ALIAS_GOLDEN_SET,
  QDRANT_ALIAS_PRE_SET,
  bootstrapPreSet,
  createBm25TextPipeline,
  tokenId,
} from '../../../src/main/retrieval/index.js';
import { resolveQdrantBinary, startTestQdrant, type TestQdrant } from './qdrant-test-utils.js';

const binary = resolveQdrantBinary();
const active: TestQdrant[] = [];

afterEach(async () => {
  for (const qdrant of active.splice(0)) {
    await qdrant.stop();
  }
});

const VALID_CONTENT = [
  '{"schema_version":"1.0","id":"pre-000001","text":"今天状态真好，太有活力了","semantic_type":"positive_praise","description":"夸赞","enabled":true,"is_bad_case":false}',
  '{"schema_version":"1.0","id":"pre-000002","text":"这反应太快了吧，笑死我了","semantic_type":"funny_joke","description":"玩笑","enabled":true,"is_bad_case":false}',
  '{"schema_version":"1.0","id":"pre-000003","text":"主播最近在追什么剧","semantic_type":"persona_relevant","description":"话题","enabled":true,"is_bad_case":false}',
].join('\n');

(binary ? describe : describe.skip)('bootstrapPreSet integration', () => {
  it('bootstraps both collections, points to them via aliases, and retrieves hits', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });

    const profile = await bootstrapPreSet(client, { content: VALID_CONTENT });

    const preSetCollection = `${QDRANT_ALIAS_PRE_SET}__${profile.profileId}`;
    const goldenSetCollection = `${QDRANT_ALIAS_GOLDEN_SET}__${profile.profileId}`;

    const info = await client.getCollection(preSetCollection);
    expect(info.points_count).toBe(3);
    expect((await client.getCollection(goldenSetCollection)).points_count).toBe(0);

    const aliases = await client.getAliases();
    const byAlias = new Map(aliases.aliases.map((a) => [a.alias_name, a.collection_name]));
    expect(byAlias.get(QDRANT_ALIAS_PRE_SET)).toBe(preSetCollection);
    expect(byAlias.get(QDRANT_ALIAS_GOLDEN_SET)).toBe(goldenSetCollection);

    const pipeline = createBm25TextPipeline();
    const queryTokens = pipeline.queryTokens('今天状态真好');
    const hits = await client.query(QDRANT_ALIAS_PRE_SET, {
      query: {
        indices: queryTokens.map((token) => tokenId(token)),
        values: queryTokens.map(() => 1),
      },
      using: 'bm25_zh_jieba_v1',
      limit: 3,
      with_payload: true,
    });
    expect(hits.points.length).toBeGreaterThan(0);
    expect(hits.points[0].payload).toMatchObject({ semantic_type: 'positive_praise' });
  }, 30_000);

  it('rejects an invalid package and leaves no temporary collections behind', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });

    const badContent = '{"schema_version":"1.0","id":"bad","text":"","semantic_type":"positive_praise","description":"d","enabled":true,"is_bad_case":false}';
    await expect(bootstrapPreSet(client, { content: badContent })).rejects.toThrow();

    const collections = await client.getCollections();
    const leftovers = collections.collections.filter((c) => c.name.startsWith('pre_set__'));
    expect(leftovers).toEqual([]);
  }, 30_000);

  it('atomically re-points aliases on a second bootstrap', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });

    const first = await bootstrapPreSet(client, { content: VALID_CONTENT });
    const second = await bootstrapPreSet(client, { content: VALID_CONTENT });

    const aliases = await client.getAliases();
    const byAlias = new Map(aliases.aliases.map((a) => [a.alias_name, a.collection_name]));
    expect(byAlias.get(QDRANT_ALIAS_PRE_SET)).toBe(`${QDRANT_ALIAS_PRE_SET}__${second.profileId}`);
    expect(byAlias.get(QDRANT_ALIAS_GOLDEN_SET)).toBe(`${QDRANT_ALIAS_GOLDEN_SET}__${second.profileId}`);

    const firstCollection = `${QDRANT_ALIAS_PRE_SET}__${first.profileId}`;
    const exists = await client.collectionExists(firstCollection);
    expect(exists.exists).toBe(true); // old collection retained for rollback window
  }, 30_000);
});
