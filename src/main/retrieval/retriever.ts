import type { QdrantClient } from '@qdrant/js-client-rest';
import type { GoldenSetPayloadV1, PreSetPayloadV1, SourceCollectionV1 } from '@echocue/contracts';
import { BM25_VECTOR_NAME_V1 } from '@echocue/contracts';
import { createBm25TextPipeline, type Bm25TextPipeline } from './Bm25TextPipeline.js';
import { tokenId } from './token-id.js';
import { QDRANT_ALIAS_GOLDEN_SET, QDRANT_ALIAS_PRE_SET } from './bootstrap.js';

export type SourceCollection = SourceCollectionV1;

export interface RetrievalRawHit {
  readonly pointId: string;
  readonly caseId: string;
  readonly collection: SourceCollection;
  readonly rawScore: number;
  readonly rank: number;
  readonly payload: PreSetPayloadV1 | GoldenSetPayloadV1;
}

export interface RetrievalSearchResult {
  readonly goldenHits: RetrievalRawHit[];
  readonly preHits: RetrievalRawHit[];
}

export interface RetrievalSearchOptions {
  queryText: string;
  personaId?: string;
  personaVersion?: string;
  topK?: number;
}

const DEFAULT_TOP_K = 10;

function matchFilter(key: string, value: boolean | string): { key: string; match: { value: boolean | string } } {
  return { key, match: { value } };
}

function baseFilter(): { must: Array<{ key: string; match: { value: boolean | string } }> } {
  return { must: [matchFilter('enabled', true), matchFilter('is_bad_case', false)] };
}

function goldenFilter(personaId: string | undefined, personaVersion: string | undefined) {
  const filter = baseFilter();
  if (personaId !== undefined && personaVersion !== undefined) {
    filter.must.push(matchFilter('persona_id', personaId), matchFilter('persona_version', personaVersion));
  }
  return filter;
}

interface RawPoint {
  id: number | string;
  score?: number;
  payload?: Record<string, unknown> | null;
}

export function normalizeHits(
  points: RawPoint[],
  collection: SourceCollection,
): RetrievalRawHit[] {
  return points.map((point, index) => {
    const payload = (point.payload ?? {}) as Record<string, unknown>;
    return {
      pointId: String(point.id),
      caseId: typeof payload.case_id === 'string' ? payload.case_id : '',
      collection,
      rawScore: point.score ?? 0,
      rank: index + 1,
      payload: payload as unknown as PreSetPayloadV1 | GoldenSetPayloadV1,
    };
  });
}

export interface SuggestionRetrieverOptions {
  aliases?: { preSet: string; goldenSet: string };
}

export class SuggestionRetriever {
  private readonly pipeline: Bm25TextPipeline;
  private readonly aliases: { preSet: string; goldenSet: string };

  constructor(
    private readonly client: QdrantClient,
    options: SuggestionRetrieverOptions = {},
  ) {
    this.pipeline = createBm25TextPipeline();
    this.aliases = options.aliases ?? { preSet: QDRANT_ALIAS_PRE_SET, goldenSet: QDRANT_ALIAS_GOLDEN_SET };
  }

  async search(options: RetrievalSearchOptions): Promise<RetrievalSearchResult> {
    if ((options.personaId === undefined) !== (options.personaVersion === undefined)) {
      throw new Error('personaId and personaVersion must be provided together');
    }
    const tokens = this.pipeline.queryTokens(options.queryText);
    if (tokens.length === 0) return { preHits: [], goldenHits: [] };
    const indices = tokens.map((token) => tokenId(token));
    const values = indices.map(() => 1);
    const topK = Math.max(1, Math.floor(options.topK ?? DEFAULT_TOP_K));
    const common = {
      query: { indices, values },
      using: BM25_VECTOR_NAME_V1,
      limit: topK,
      with_payload: true,
    };

    const [preResult, goldenResult] = await Promise.all([
      this.client.query(this.aliases.preSet, { ...common, filter: baseFilter() }),
      this.client.query(this.aliases.goldenSet, {
        ...common,
        filter: goldenFilter(options.personaId, options.personaVersion),
      }),
    ]);

    return {
      preHits: normalizeHits(preResult.points ?? [], 'pre_set'),
      goldenHits: normalizeHits(goldenResult.points ?? [], 'golden_set'),
    };
  }
}
