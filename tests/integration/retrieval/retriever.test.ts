import { QdrantClient } from '@qdrant/js-client-rest';
import type { GoldenSetPayloadV1 } from '@echocue/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  QDRANT_ALIAS_GOLDEN_SET,
  SuggestionRetriever,
  bootstrapPreSet,
  buildDocumentVector,
  createBm25TextPipeline,
} from '../../../src/main/retrieval/index.js';
import { uuidv5, uuidv7 } from '../../../src/main/util/index.js';
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
].join('\n');

(binary ? describe : describe.skip)('SuggestionRetriever integration', () => {
  it('returns pre_set hits and persona-filtered golden hits', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });

    const profile = await bootstrapPreSet(client, { content: VALID_CONTENT });
    const pipeline = createBm25TextPipeline();

    const golden: GoldenSetPayloadV1 = {
      case_id: 'gc-1',
      tokenizer_version: 'zh_jieba_search_v1',
      source_trace_id: uuidv7(),
      persona_id: 'p-1',
      persona_version: uuidv7(),
      text: '今天状态真好',
      semantic_type: 'positive_praise',
      reply: '谢谢你！',
      cues: ['接住夸奖', '继续互动'],
      quality_score: 90,
      enabled: true,
      is_bad_case: false,
      created_at: '2026-08-22T00:00:00.000Z',
      updated_at: '2026-08-22T00:00:00.000Z',
    };
    const analyzed = pipeline.analyze(golden.text);
    const vector = buildDocumentVector(analyzed, profile);
    await client.upsert(QDRANT_ALIAS_GOLDEN_SET, {
      wait: true,
      points: [{
        id: uuidv5(`echocue:golden_set:${golden.case_id}`),
        vector: { bm25_zh_jieba_v1: { indices: vector.indices, values: vector.values } },
        payload: golden,
      }],
    });

    const retriever = new SuggestionRetriever(client);
    const matching = await retriever.search({ queryText: '今天状态真好', personaId: 'p-1', personaVersion: golden.persona_version, topK: 5 });
    expect(matching.preHits.length).toBeGreaterThan(0);
    expect(matching.preHits[0].payload).toMatchObject({ semantic_type: 'positive_praise' });
    expect(matching.goldenHits.length).toBeGreaterThan(0);
    expect(matching.goldenHits[0]).toMatchObject({ collection: 'golden_set', caseId: 'gc-1' });

    const filtered = await retriever.search({ queryText: '今天状态真好', personaId: 'p-2', personaVersion: 'other-version', topK: 5 });
    expect(filtered.goldenHits).toEqual([]);
    expect(filtered.preHits.length).toBeGreaterThan(0);
  }, 30_000);
});
