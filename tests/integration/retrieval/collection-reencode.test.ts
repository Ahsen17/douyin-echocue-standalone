import { BM25_TOKENIZER_VERSION_V1, E_TOKENIZER_MISMATCH_V1, type Bm25ZhJiebaProfileV1 } from '@echocue/contracts';
import { randomUUID } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  QDRANT_ALIAS_GOLDEN_SET,
  QDRANT_ALIAS_PRE_SET,
  bootstrapPreSet,
  createCollectionWithSparse,
  createRetrievalControlHandlers,
  readGoldenEntries,
  tokenId,
} from '../../../src/main/retrieval/index.js';
import { createServiceGateChecks } from '../../../src/main/service/service-gate.js';
import { resolveQdrantBinary, startTestQdrant, type TestQdrant } from './qdrant-test-utils.js';
import { uuidv7 } from '../../../src/main/util/index.js';

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
].join('\n');

function goldenPayload(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    case_id: 'g-legacy-1',
    tokenizer_version: 'zh_jieba_search_v1',
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
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function seedProfile(): Bm25ZhJiebaProfileV1 {
  return {
    profileId: 'seed',
    tokenizerVersion: BM25_TOKENIZER_VERSION_V1,
    normalizationVersion: 'zh_bm25_normalize_v1',
    preSetSha256: 'a'.repeat(64),
    avgDocLenBaseline: 5,
    k1: 1.2,
    b: 0.75,
    qdrantVersion: '1.19.0',
    calibrationArtifactId: 'seed',
  };
}

/** Seed a golden collection built with a stale tokenizer behind the golden alias. */
async function seedLegacyGolden(
  client: QdrantClient,
  profile: Bm25ZhJiebaProfileV1,
  payloads: Array<Record<string, unknown>>,
): Promise<string> {
  const legacy = 'golden_set__legacy';
  const stale = { ...profile, tokenizerVersion: 'zh_jieba_search_v1' } as unknown as Bm25ZhJiebaProfileV1;
  await createCollectionWithSparse(client, { collectionName: legacy, profile: stale, golden: true });
  await client.updateCollectionAliases({
    actions: [{ create_alias: { collection_name: legacy, alias_name: QDRANT_ALIAS_GOLDEN_SET } }],
  });
  // A real upgrade also has a stale pre_set behind its alias; without it the
  // status would report plain needs-import instead of the mismatch code.
  const legacyPreSet = 'pre_set__legacy';
  await createCollectionWithSparse(client, { collectionName: legacyPreSet, profile: stale, golden: false });
  await client.updateCollectionAliases({
    actions: [{ create_alias: { collection_name: legacyPreSet, alias_name: QDRANT_ALIAS_PRE_SET } }],
  });
  if (payloads.length > 0) {
    await client.upsert(legacy, {
      wait: true,
      // The migration reads payloads only, so the stale encodings here are
      // placeholders that just make the points exist (Qdrant requires a UUID
      // id and a vector per point).
      points: payloads.map((payload) => ({
        id: randomUUID(),
        vector: { bm25_zh_jieba_v1: { indices: [tokenId('legacy')], values: [1] } },
        payload,
      })),
    });
  }
  return legacy;
}

(binary ? describe : describe.skip)('tokenizer-version migration (TD-11)', () => {
  it('re-encodes golden payloads into the new collection, switches both aliases, and drops the old collections', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });

    const legacyGolden = await seedLegacyGolden(client, seedProfile(), [
      goldenPayload(),
      goldenPayload({ case_id: 'g-legacy-2', is_bad_case: true, text: '主播翻车的瞬间' }),
    ]);

    const profile = await bootstrapPreSet(client, { content: VALID_CONTENT });

    const byAlias = new Map(
      (await client.getAliases()).aliases.map((a) => [a.alias_name, a.collection_name]),
    );
    const newGolden = `${QDRANT_ALIAS_GOLDEN_SET}__${profile.profileId}`;
    expect(byAlias.get(QDRANT_ALIAS_PRE_SET)).toBe(`${QDRANT_ALIAS_PRE_SET}__${profile.profileId}`);
    expect(byAlias.get(QDRANT_ALIAS_GOLDEN_SET)).toBe(newGolden);

    expect((await client.getCollection(newGolden)).points_count).toBe(2);
    expect((await client.collectionExists(legacyGolden)).exists).toBe(false);

    const entries = await readGoldenEntries(client, QDRANT_ALIAS_GOLDEN_SET);
    const byCaseId = new Map(entries.map((e) => [e.payload.case_id as string, e.payload]));
    expect(byCaseId.get('g-legacy-1')).toMatchObject({
      tokenizer_version: BM25_TOKENIZER_VERSION_V1,
      persona_id: 'p-1',
      quality_score: 90,
      is_bad_case: false,
    });
    expect(byCaseId.get('g-legacy-2')).toMatchObject({ is_bad_case: true, persona_id: 'p-1' });
  }, 60_000);

  it('drops golden points whose text no longer tokenizes under the new tokenizer', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });

    await seedLegacyGolden(client, seedProfile(), [
      goldenPayload(),
      goldenPayload({ case_id: 'g-stopword-only', text: '的吗了吧' }),
    ]);

    const profile = await bootstrapPreSet(client, { content: VALID_CONTENT });

    const entries = await readGoldenEntries(client, QDRANT_ALIAS_GOLDEN_SET);
    expect(entries.map((e) => e.payload.case_id)).toEqual(['g-legacy-1']);
    expect((await client.getCollection(`${QDRANT_ALIAS_GOLDEN_SET}__${profile.profileId}`)).points_count).toBe(1);
  }, 60_000);

  it('refuses the migration when a golden payload is invalid and leaves everything untouched', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });

    const legacyGolden = await seedLegacyGolden(client, seedProfile(), [
      goldenPayload({ quality_score: undefined }),
    ]);

    await expect(bootstrapPreSet(client, { content: VALID_CONTENT })).rejects.toThrow(
      /refusing to migrate/,
    );

    const byAlias = new Map(
      (await client.getAliases()).aliases.map((a) => [a.alias_name, a.collection_name]),
    );
    expect(byAlias.get(QDRANT_ALIAS_GOLDEN_SET)).toBe(legacyGolden);
    expect(byAlias.get(QDRANT_ALIAS_PRE_SET)).toBe('pre_set__legacy');
    expect((await client.getCollection(legacyGolden)).points_count).toBe(1);
    // The failed run left no new collections behind.
    const leftovers = (await client.getCollections()).collections
      .map((c) => c.name)
      .filter((n) => n.startsWith('pre_set__') || n.startsWith('golden_set__'));
    expect(leftovers).toEqual([legacyGolden, 'pre_set__legacy']);
  }, 60_000);

  it('routes a stale collection to mismatch in getStatus and blocks the service gate until migrated', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });
    const handlers = createRetrievalControlHandlers({
      qdrant: qdrant.manager,
      client,
      isServiceStopped: () => true,
    });
    const gate = createServiceGateChecks({
      settings: {} as never,
      credentials: {} as never,
      audit: {} as never,
      persona: {} as never,
      safety: {} as never,
      qdrant: qdrant.manager,
      qdrantClient: client,
    });

    await seedLegacyGolden(client, seedProfile(), [goldenPayload()]);
    await expect(handlers.getStatus()).resolves.toEqual({
      qdrantHealthy: true,
      ready: false,
      error: E_TOKENIZER_MISMATCH_V1,
    });
    await expect(gate.isRetrievalReady()).resolves.toBe(false);

    await bootstrapPreSet(client, { content: VALID_CONTENT });

    await expect(handlers.getStatus()).resolves.toMatchObject({ qdrantHealthy: true, ready: true });
    await expect(gate.isRetrievalReady()).resolves.toBe(true);
  }, 60_000);

  it('keeps a version-compatible golden collection untouched on re-import', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });

    await bootstrapPreSet(client, { content: VALID_CONTENT });
    const byAliasBefore = new Map(
      (await client.getAliases()).aliases.map((a) => [a.alias_name, a.collection_name]),
    );
    const firstGolden = byAliasBefore.get(QDRANT_ALIAS_GOLDEN_SET)!;

    await bootstrapPreSet(client, { content: VALID_CONTENT });

    const byAlias = new Map(
      (await client.getAliases()).aliases.map((a) => [a.alias_name, a.collection_name]),
    );
    expect(byAlias.get(QDRANT_ALIAS_GOLDEN_SET)).toBe(firstGolden);
    expect((await client.getCollection(firstGolden)).points_count).toBe(0);
    expect((await client.collectionExists(firstGolden)).exists).toBe(true);
  }, 60_000);
});
