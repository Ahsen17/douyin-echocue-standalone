import { QdrantClient } from '@qdrant/js-client-rest';
import type { GoldenSetPayloadV1 } from '@echocue/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  QDRANT_ALIAS_GOLDEN_SET,
  SuggestionRetriever,
  bootstrapPreSet,
  buildDocumentVector,
  buildRetrievalResult,
  createBm25TextPipeline,
  evaluateDirectPush,
  evaluateRetrieval,
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
  '{"schema_version":"1.0","id":"pre-000001","text":"这波操作真的秀，直接起飞","semantic_type":"funny_joke","description":"玩笑","enabled":true,"is_bad_case":false}',
].join('\n');

(binary ? describe : describe.skip)('golden direct-push integration', () => {
  it('flags a current-version high-confidence golden top1 as direct-eligible', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });

    const profile = await bootstrapPreSet(client, { content: VALID_CONTENT });
    const pipeline = createBm25TextPipeline();

    const personaId = 'p-1';
    const personaVersion = uuidv7();
    const golden: GoldenSetPayloadV1 = {
      case_id: 'gc-1',
      tokenizer_version: 'zh_jieba_search_v1',
      source_trace_id: uuidv7(),
      persona_id: personaId,
      persona_version: personaVersion,
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
    const raw = await retriever.search({
      queryText: '今天状态真好',
      personaId,
      personaVersion,
      topK: 5,
    });
    // Default artifact params are POC placeholders; a test artifact calibrated to
    // the single-golden-point score distribution puts the real hit above 0.85.
    const evaluated = evaluateRetrieval(raw, {
      artifact: {
        artifactId: 'test',
        version: 'v1.0',
        preSet: { center: 0, scale: 2 },
        goldenSet: { center: 0.5, scale: 0.3 },
        semanticDiscardConfidence: 0.9,
      },
    });
    const decision = evaluateDirectPush(evaluated.mergedTopK, {
      personaId,
      personaVersion,
      directPushThreshold: 0.85,
    });

    expect(decision.eligible).toBe(true);
    expect(decision.pointId).toBeDefined();
    expect(decision.reason).toBe('GOLDEN_DIRECT_ELIGIBLE');

    const result = buildRetrievalResult({
      traceId: uuidv7(),
      calibrationVersion: evaluated.calibrationVersion,
      goldenHits: evaluated.goldenHits,
      preHits: evaluated.preHits,
      mergedTopK: evaluated.mergedTopK,
      directPush: decision,
    });
    expect(result.directPushEligible).toBe(true);
    expect(result.directPointId).toBe(decision.pointId);
  }, 30_000);

  it('does not direct-push when the golden point belongs to another persona', async () => {
    const qdrant = await startTestQdrant();
    active.push(qdrant);
    const client = new QdrantClient({ host: '127.0.0.1', port: qdrant.manager.httpPort });

    const profile = await bootstrapPreSet(client, { content: VALID_CONTENT });
    const pipeline = createBm25TextPipeline();

    const golden: GoldenSetPayloadV1 = {
      case_id: 'gc-2',
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
    const raw = await retriever.search({
      queryText: '今天状态真好',
      personaId: 'p-2',
      personaVersion: uuidv7(),
      topK: 5,
    });
    const evaluated = evaluateRetrieval(raw);
    const decision = evaluateDirectPush(evaluated.mergedTopK, {
      personaId: 'p-2',
      personaVersion: uuidv7(),
      directPushThreshold: 0.85,
    });

    // golden filter excludes the other persona's point; nothing to push
    expect(evaluated.goldenHits).toEqual([]);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe('LLM_REQUIRED');
  }, 30_000);
});
