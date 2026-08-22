import { describe, expect, it } from 'vitest';
import { PreSetPayloadV1Schema } from '@echocue/contracts';
import { importPreSet } from '../../../src/main/retrieval/index.js';
import {
  buildPreSetPoints,
  computeProfile,
  contentSha256,
  preSetPointId,
  stagePreSet,
  toPreSetPayload,
} from '../../../src/main/retrieval/index.js';
import { createBm25TextPipeline } from '../../../src/main/retrieval/index.js';

const VALID_CONTENT = [
  '{"schema_version":"1.0","id":"pre-000001","text":"今天状态真好","semantic_type":"positive_praise","description":"夸赞","enabled":true,"is_bad_case":false}',
  '{"schema_version":"1.0","id":"pre-000002","text":"这反应太快了，笑死我了","semantic_type":"funny_joke","description":"玩笑","enabled":true,"is_bad_case":false}',
].join('\n');

function validEntries() {
  const imported = importPreSet({ content: VALID_CONTENT });
  if (!imported.ok) throw new Error('fixture must import');
  return imported.entries;
}

describe('contentSha256', () => {
  it('is deterministic and lowercase-hex', () => {
    const a = contentSha256(VALID_CONTENT);
    const b = contentSha256(VALID_CONTENT);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeProfile', () => {
  it('freezes avg_doc_len baseline and FastEmbed defaults', () => {
    const pipeline = createBm25TextPipeline();
    const profile = computeProfile({
      entries: validEntries(),
      pipeline,
      preSetSha256: contentSha256(VALID_CONTENT),
    });
    expect(profile.k1).toBe(1.2);
    expect(profile.b).toBe(0.75);
    expect(profile.qdrantVersion).toBe('1.19.0');
    expect(profile.tokenizerVersion).toBe(pipeline.tokenizerVersion);
    expect(profile.normalizationVersion).toBe(pipeline.normalizationVersion);
    expect(profile.avgDocLenBaseline).toBeGreaterThan(0);
    expect(profile.preSetSha256).toBe(contentSha256(VALID_CONTENT));
    expect(profile.profileId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('preSetPointId', () => {
  it('is deterministic and version-5', () => {
    const id = preSetPointId('pre-000001');
    expect(id).toBe(preSetPointId('pre-000001'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(preSetPointId('pre-000001')).not.toBe(preSetPointId('pre-000002'));
  });
});

describe('toPreSetPayload', () => {
  it('maps a validated entry to the contract payload', () => {
    const entry = validEntries()[0];
    const payload = toPreSetPayload(entry, entry.id);
    expect(payload.case_id).toBe(entry.id);
    expect(payload.tokenizer_version).toBe('zh_jieba_search_v1');
    expect(payload.schema_version).toBe('1.0');
    expect(payload.text).toBe(entry.text);
    expect(payload.semantic_type).toBe(entry.semantic_type);
    expect(PreSetPayloadV1Schema.safeParse(payload).success).toBe(true);
  });
});

describe('buildPreSetPoints', () => {
  it('produces named sparse vectors with deterministic point ids', () => {
    const pipeline = createBm25TextPipeline();
    const profile = computeProfile({
      entries: validEntries(),
      pipeline,
      preSetSha256: contentSha256(VALID_CONTENT),
    });
    const staged = stagePreSet(validEntries(), pipeline);
    const points = buildPreSetPoints({ staged, profile });
    expect(points).toHaveLength(2);
    for (const point of points) {
      const vector = point.vector['bm25_zh_jieba_v1'];
      expect(vector.indices.length).toBeGreaterThan(0);
      expect(vector.indices.length).toBe(vector.values.length);
      expect(point.payload.case_id).toMatch(/^pre-\d+$/);
      expect(point.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(points[0].id).not.toBe(points[1].id);
  });
});
