import { describe, expect, it, vi } from 'vitest';
import type { Bm25ZhJiebaProfileV1 } from '@echocue/contracts';
import { PreSetImportResultV1Schema } from '@echocue/contracts';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { QdrantSidecarManager } from '../../../src/main/qdrant/index.js';
import { createRetrievalControlHandlers } from '../../../src/main/retrieval/index.js';

const PROFILE: Bm25ZhJiebaProfileV1 = {
  profileId: '018f0a1b2c3d4e5f6a7b8c9d',
  tokenizerVersion: 'zh_jieba_search_v1',
  normalizationVersion: 'zh_bm25_normalize_v1',
  preSetSha256: 'a'.repeat(64),
  avgDocLenBaseline: 12.5,
  k1: 1.2,
  b: 0.75,
  qdrantVersion: '1.19.0',
  calibrationArtifactId: 'pending-calibration',
};

const VALID_CONTENT = [
  '{"schema_version":"1.0","id":"pre-000001","text":"今天状态真好","semantic_type":"positive_praise","description":"对状态的夸赞","enabled":true,"is_bad_case":false}',
  '{"schema_version":"1.0","id":"pre-000002","text":"这波操作真的秀","semantic_type":"funny_joke","description":"轻松玩笑","enabled":true,"is_bad_case":false}',
].join('\n');

interface Fakes {
  qdrant: { isHealthy: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> };
  client: { collectionExists: ReturnType<typeof vi.fn>; getCollection: ReturnType<typeof vi.fn> };
}

function makeFakes(): Fakes {
  return {
    qdrant: { isHealthy: vi.fn(async () => true), start: vi.fn(async () => ({ pid: 1, httpPort: 6333 })) },
    client: {
      collectionExists: vi.fn(async () => ({ exists: false })),
      getCollection: vi.fn(async () => ({ config: { metadata: {} } })),
    },
  };
}

function makeHandlers(
  fakes: Fakes,
  overrides: { bootstrap?: ReturnType<typeof vi.fn>; isServiceStopped?: () => boolean } = {},
) {
  return createRetrievalControlHandlers({
    qdrant: fakes.qdrant as unknown as QdrantSidecarManager,
    client: fakes.client as unknown as QdrantClient,
    isServiceStopped: overrides.isServiceStopped ?? (() => true),
    bootstrap: overrides.bootstrap ?? (vi.fn(async () => PROFILE) as never),
  });
}

describe('retrieval.getStatus', () => {
  it('reports unavailable when the qdrant sidecar is not healthy', async () => {
    const fakes = makeFakes();
    fakes.qdrant.isHealthy.mockResolvedValue(false);
    const handlers = makeHandlers(fakes);
    await expect(handlers.getStatus()).resolves.toEqual({
      qdrantHealthy: false,
      ready: false,
      error: 'E_QDRANT_UNAVAILABLE',
    });
    expect(fakes.client.collectionExists).not.toHaveBeenCalled();
  });

  it('reports needs-import when healthy but pre_set is not bootstrapped', async () => {
    const fakes = makeFakes();
    const handlers = makeHandlers(fakes);
    await expect(handlers.getStatus()).resolves.toEqual({ qdrantHealthy: true, ready: false });
  });

  it('reports ready with the profile facts from collection metadata', async () => {
    const fakes = makeFakes();
    fakes.client.collectionExists.mockResolvedValue({ exists: true });
    fakes.client.getCollection.mockResolvedValue({
      config: { metadata: { profile_id: PROFILE.profileId, pre_set_sha256: PROFILE.preSetSha256 } },
    });
    const handlers = makeHandlers(fakes);
    await expect(handlers.getStatus()).resolves.toEqual({
      qdrantHealthy: true,
      ready: true,
      profileId: PROFILE.profileId,
      preSetSha256: PROFILE.preSetSha256,
    });
  });

  it('reports not-ready with an error when reading the collection fails', async () => {
    const fakes = makeFakes();
    fakes.client.collectionExists.mockResolvedValue({ exists: true });
    fakes.client.getCollection.mockRejectedValue(new Error('boom'));
    const handlers = makeHandlers(fakes);
    await expect(handlers.getStatus()).resolves.toEqual({
      qdrantHealthy: true,
      ready: false,
      error: 'E_QDRANT_UNAVAILABLE',
    });
  });
});

describe('retrieval.importPreSet', () => {
  it('imports a valid package and returns the frozen profile + entry count', async () => {
    const fakes = makeFakes();
    const bootstrap = vi.fn(async () => PROFILE);
    const handlers = makeHandlers(fakes, { bootstrap });
    const result = await handlers.importPreSet({ content: VALID_CONTENT });
    expect(result).toMatchObject({ ok: true, entryCount: 2, profile: PROFILE });
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(bootstrap.mock.calls[0][0]).toBe(fakes.client);
  });

  it('returns line-scoped errors whole-package when validation fails', async () => {
    const fakes = makeFakes();
    const bootstrap = vi.fn(async () => PROFILE);
    const handlers = makeHandlers(fakes, { bootstrap });
    const bad = [
      '{"schema_version":"1.0","id":"pre-000001","text":"正常","semantic_type":"positive_praise","description":"d","enabled":true,"is_bad_case":false}',
      '{"schema_version":"1.0","id":"pre-000001","text":"重复 id","semantic_type":"positive_praise","description":"d","enabled":true,"is_bad_case":false}',
      'not json',
    ].join('\n');
    const result = await handlers.importPreSet({ content: bad });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.errorCode)).toContain('PRE_SET_DUPLICATE_ID');
    expect(result.errors.map((e) => e.errorCode)).toContain('PRE_SET_JSON');
    expect(bootstrap).not.toHaveBeenCalled();
    // no partial import and no case text in the report
    expect(result).not.toHaveProperty('profile');
    expect(JSON.stringify(result.errors)).not.toContain('重复 id');
  });

  it('truncates a very large error list and marks it truncated', async () => {
    const fakes = makeFakes();
    const handlers = makeHandlers(fakes);
    // 150 invalid lines → 150 errors, only the first 100 cross IPC.
    const bad = Array.from({ length: 150 }, () => 'not json').join('\n');
    const result = await handlers.importPreSet({ content: bad });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it('starts the qdrant sidecar first when it is not healthy', async () => {
    const fakes = makeFakes();
    fakes.qdrant.isHealthy.mockResolvedValue(false);
    const handlers = makeHandlers(fakes);
    const result = await handlers.importPreSet({ content: VALID_CONTENT });
    expect(fakes.qdrant.start).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it('rejects import while the service is running', async () => {
    const fakes = makeFakes();
    const handlers = makeHandlers(fakes, { isServiceStopped: () => false });
    await expect(handlers.importPreSet({ content: VALID_CONTENT })).rejects.toThrow(/停止服务/);
    expect(fakes.qdrant.start).not.toHaveBeenCalled();
  });

  it('serializes concurrent imports so bootstrap never overlaps', async () => {
    const fakes = makeFakes();
    let active = 0;
    let maxActive = 0;
    const bootstrap = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return PROFILE;
    });
    const handlers = makeHandlers(fakes, { bootstrap });
    const [a, b] = await Promise.all([
      handlers.importPreSet({ content: VALID_CONTENT }),
      handlers.importPreSet({ content: VALID_CONTENT }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it('serializes three concurrent imports so bootstrap never overlaps (promise chain)', async () => {
    const fakes = makeFakes();
    let active = 0;
    let maxActive = 0;
    const bootstrap = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return PROFILE;
    });
    const handlers = makeHandlers(fakes, { bootstrap });
    const [a, b, c] = await Promise.all([
      handlers.importPreSet({ content: VALID_CONTENT }),
      handlers.importPreSet({ content: VALID_CONTENT }),
      handlers.importPreSet({ content: VALID_CONTENT }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(true);
    expect(bootstrap).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
  });

  it('re-checks the stopped guard after queuing behind another import', async () => {
    const fakes = makeFakes();
    let serviceStopped = true;
    let releaseFirst!: () => void;
    let markEntered!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const bootstrap = vi.fn(async () => {
      markEntered();
      await gate;
      return PROFILE;
    });
    const handlers = makeHandlers(fakes, { bootstrap, isServiceStopped: () => serviceStopped });
    const first = handlers.importPreSet({ content: VALID_CONTENT });
    // Wait until the first import has passed its own guard and entered bootstrap,
    // then queue a second import behind it and start the service in between.
    await entered;
    const second = handlers.importPreSet({ content: VALID_CONTENT });
    // Attach the rejection handler immediately so the queued abort is not an
    // unhandled rejection while the first import is still being awaited.
    const secondError = second.then(
      () => null,
      (err: unknown) => err,
    );
    serviceStopped = false;
    releaseFirst();
    await expect(first).resolves.toMatchObject({ ok: true });
    const err = await secondError;
    expect(err).not.toBeNull();
    expect((err as Error).message).toMatch(/停止服务/);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('clamps over-long error id/path so the result still satisfies the IPC schema', async () => {
    const fakes = makeFakes();
    const handlers = makeHandlers(fakes);
    const longId = `pre-${'x'.repeat(100)}`;
    const bad = `{"schema_version":"1.0","id":"${longId}","text":"","semantic_type":"positive_praise","description":"d","enabled":true,"is_bad_case":false}`;
    const result = await handlers.importPreSet({ content: bad });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors[0];
    expect(err.errorCode).toBe('PRE_SET_SCHEMA');
    expect(err.id?.length).toBeLessThanOrEqual(68);
    expect(PreSetImportResultV1Schema.safeParse(result).success).toBe(true);
  });

  it('rejects a malformed request payload before touching qdrant', async () => {
    const fakes = makeFakes();
    const handlers = makeHandlers(fakes);
    await expect(handlers.importPreSet({ content: 42 })).rejects.toThrow(/导入请求不合法/);
    expect(fakes.qdrant.start).not.toHaveBeenCalled();
  });
});
