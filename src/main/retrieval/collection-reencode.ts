import type { QdrantClient } from '@qdrant/js-client-rest';
import type { GoldenSetPayloadV1 } from '@echocue/contracts';
import { GoldenSetPayloadV1Schema } from '@echocue/contracts';
import { BM25_VECTOR_NAME_V1 } from '@echocue/contracts';
import type { Bm25TextPipeline } from './Bm25TextPipeline.js';
import { buildDocumentVector, type GoldenProfileParams } from './bm25-weights.js';

export interface GoldenCollectionEntry {
  readonly id: string;
  readonly payload: Record<string, unknown>;
}

export interface ReencodedGoldenPoint {
  readonly id: string;
  readonly payload: GoldenSetPayloadV1;
  readonly vector: Record<string, { indices: number[]; values: number[] }>;
}

export interface ReencodeResult {
  readonly points: ReencodedGoldenPoint[];
  readonly skippedInvalidPayload: number;
  readonly skippedEmptyVector: number;
}

const SCROLL_PAGE_LIMIT = 256;

/**
 * Read every golden point's payload from the collection behind an alias.
 * Payload (not SQLite) is the source of truth for golden points, so a
 * tokenizer-version migration re-encodes from here; SQLite replay would lose
 * points past the audit retention window.
 */
export async function readGoldenEntries(
  client: QdrantClient,
  alias: string,
): Promise<GoldenCollectionEntry[]> {
  const entries: GoldenCollectionEntry[] = [];
  let offset: string | number | undefined;
  for (;;) {
    const page = await client.scroll(alias, {
      limit: SCROLL_PAGE_LIMIT,
      with_payload: true,
      with_vector: false,
      ...(offset !== undefined ? { offset } : {}),
    });
    for (const point of page.points) {
      entries.push({
        id: String(point.id),
        payload: (point.payload ?? {}) as Record<string, unknown>,
      });
    }
    const next = page.next_page_offset;
    if (next === null || next === undefined) break;
    offset = next as string | number;
  }
  return entries;
}

/**
 * Re-derive each golden point's sparse vector under the new profile/pipeline
 * while keeping point id and payload identity. The payload's tokenizer_version
 * is the one field rewritten, so strict payload validation still holds.
 * Points whose text tokenizes to nothing are skipped: Qdrant rejects
 * vector-less upserts on a named-vector collection, and such points carry no
 * retrieval value anyway.
 */
export function reencodeGoldenEntries(
  entries: readonly GoldenCollectionEntry[],
  profile: GoldenProfileParams,
  pipeline: Bm25TextPipeline,
): ReencodeResult {
  const points: ReencodedGoldenPoint[] = [];
  let skippedInvalidPayload = 0;
  let skippedEmptyVector = 0;
  for (const entry of entries) {
    const raw = { ...entry.payload, tokenizer_version: pipeline.tokenizerVersion };
    const parsed = GoldenSetPayloadV1Schema.safeParse(raw);
    if (!parsed.success) {
      skippedInvalidPayload += 1;
      continue;
    }
    const payload = parsed.data;
    const analyzed = pipeline.analyze(payload.text);
    if (analyzed.tokens.length === 0) {
      skippedEmptyVector += 1;
      continue;
    }
    const vector = buildDocumentVector(analyzed, profile);
    points.push({
      id: entry.id,
      payload,
      vector: { [BM25_VECTOR_NAME_V1]: { indices: vector.indices, values: vector.values } },
    });
  }
  return { points, skippedInvalidPayload, skippedEmptyVector };
}
