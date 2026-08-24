import { QdrantClient } from '@qdrant/js-client-rest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  QDRANT_ALIAS_GOLDEN_SET,
  QDRANT_ALIAS_PRE_SET,
  createRetrievalControlHandlers,
} from '../../../src/main/retrieval/index.js';
import { createServiceGateChecks } from '../../../src/main/service/service-gate.js';
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

const VALID_CONTENT_B = [
  '{"schema_version":"1.0","id":"pre-000010","text":"今天天气不错适合直播","semantic_type":"atmosphere_boost","description":"氛围","enabled":true,"is_bad_case":false}',
  '{"schema_version":"1.0","id":"pre-000011","text":"刚才那个梗我没接住","semantic_type":"funny_joke","description":"自嘲","enabled":true,"is_bad_case":false}',
].join('\n');

(binary ? describe : describe.skip)('retrieval init handlers integration (gap fix)', () => {
  it('imports pre_set, flips getStatus to ready, and opens the retrieval gate', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });
    const handlers = createRetrievalControlHandlers({
      qdrant: qdrant.manager,
      client,
      isServiceStopped: () => true,
    });

    await expect(handlers.getStatus()).resolves.toEqual({ qdrantHealthy: true, ready: false });

    const result = await handlers.importPreSet({ content: VALID_CONTENT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entryCount).toBe(3);

    const status = await handlers.getStatus();
    expect(status).toMatchObject({ qdrantHealthy: true, ready: true });
    expect(status.profileId).toBe(result.profile.profileId);
    expect(status.preSetSha256).toBe(result.profile.preSetSha256);

    // Gate closure: the exact isRetrievalReady predicate (RUNBOOK §4.1) that
    // previously blocked every start now passes with the real manager+client.
    const gate = createServiceGateChecks({
      settings: {} as never,
      credentials: {} as never,
      audit: {} as never,
      persona: {} as never,
      safety: {} as never,
      qdrant: qdrant.manager,
      qdrantClient: client,
    });
    await expect(gate.isRetrievalReady()).resolves.toBe(true);
  }, 60_000);

  it('rejects an invalid package whole-package and keeps the active profile', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });
    const handlers = createRetrievalControlHandlers({
      qdrant: qdrant.manager,
      client,
      isServiceStopped: () => true,
    });

    const first = await handlers.importPreSet({ content: VALID_CONTENT });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const bad = [
      '{"schema_version":"1.0","id":"pre-000001","text":"","semantic_type":"positive_praise","description":"d","enabled":true,"is_bad_case":false}',
      'not json',
    ].join('\n');
    const failed = await handlers.importPreSet({ content: bad });
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.errors.map((e) => e.errorCode)).toContain('PRE_SET_SCHEMA');
    expect(failed.errors.map((e) => e.errorCode)).toContain('PRE_SET_JSON');

    // The active profile is untouched: same alias target, still ready.
    const aliases = await client.getAliases();
    const byAlias = new Map(aliases.aliases.map((a) => [a.alias_name, a.collection_name]));
    expect(byAlias.get(QDRANT_ALIAS_PRE_SET)).toBe(`${QDRANT_ALIAS_PRE_SET}__${first.profile.profileId}`);
    await expect(handlers.getStatus()).resolves.toMatchObject({
      qdrantHealthy: true,
      ready: true,
      profileId: first.profile.profileId,
    });
  }, 60_000);

  it('atomically re-points aliases on a second import and keeps the old profile', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });
    const handlers = createRetrievalControlHandlers({
      qdrant: qdrant.manager,
      client,
      isServiceStopped: () => true,
    });

    const first = await handlers.importPreSet({ content: VALID_CONTENT });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await handlers.importPreSet({ content: VALID_CONTENT_B });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.profile.profileId).not.toBe(first.profile.profileId);

    const aliases = await client.getAliases();
    const byAlias = new Map(aliases.aliases.map((a) => [a.alias_name, a.collection_name]));
    expect(byAlias.get(QDRANT_ALIAS_PRE_SET)).toBe(`${QDRANT_ALIAS_PRE_SET}__${second.profile.profileId}`);
    // WP-8: a re-import must not replace the golden_set alias; it stays on the
    // first bootstrap's collection so labeled reflux is never wiped.
    expect(byAlias.get(QDRANT_ALIAS_GOLDEN_SET)).toBe(`${QDRANT_ALIAS_GOLDEN_SET}__${first.profile.profileId}`);

    // Old profile collections stay for the rollback window (RUNBOOK §8.2).
    const oldPre = await client.collectionExists(`${QDRANT_ALIAS_PRE_SET}__${first.profile.profileId}`);
    expect(oldPre.exists).toBe(true);
  }, 60_000);
});
