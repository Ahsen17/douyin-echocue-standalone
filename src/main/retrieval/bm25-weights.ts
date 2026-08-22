import type { Bm25ZhJiebaProfileV1 } from '@echocue/contracts';
import { tokenId } from './token-id.js';
import type { Bm25Analysis } from './types.js';

export const BM25_K1_INITIAL = 1.2;
export const BM25_B_INITIAL = 0.75;

export interface TokenCollision {
  readonly tokenA: string;
  readonly tokenB: string;
  readonly id: number;
}

export interface DocumentVector {
  readonly indices: number[];
  readonly values: number[];
  readonly collisions: TokenCollision[];
}

// Doc-side BM25 term weight, no IDF (CONTRACT §4). IDF is applied by Qdrant at
// query time via modifier:idf; pre-writing it would double-weight.
// Precondition: profile.avgDocLenBaseline > 0, enforced by Bm25ZhJiebaProfileV1Schema.
export function docTermWeight(
  tf: number,
  docLen: number,
  profile: Bm25ZhJiebaProfileV1,
): number {
  const { k1, b, avgDocLenBaseline } = profile;
  const denom = tf + k1 * (1 - b + (b * docLen) / avgDocLenBaseline);
  return (tf * (k1 + 1)) / denom;
}

export function computeAvgDocLenBaseline(docLengths: readonly number[]): number {
  if (docLengths.length === 0) return 0;
  return docLengths.reduce((sum, n) => sum + n, 0) / docLengths.length;
}

export function buildDocumentVector(
  analyzed: Bm25Analysis,
  profile: Bm25ZhJiebaProfileV1,
  tokenIdFn: (token: string) => number = tokenId,
): DocumentVector {
  const weights = new Map<number, number>();
  const collisions: TokenCollision[] = [];
  const tokenByIndex = new Map<number, string>();
  for (const [token, tf] of analyzed.tf) {
    const id = tokenIdFn(token);
    const existing = tokenByIndex.get(id);
    if (existing !== undefined && existing !== token) {
      // 32-bit collision within one document: keep the diagnostic, do not swap
      // to a stateful dictionary that would break index stability.
      collisions.push({ tokenA: existing, tokenB: token, id });
    } else {
      tokenByIndex.set(id, token);
    }
    weights.set(id, (weights.get(id) ?? 0) + docTermWeight(tf, analyzed.docLen, profile));
  }
  const indices = [...weights.keys()].sort((a, b) => a - b);
  return {
    indices,
    values: indices.map((index) => weights.get(index) ?? 0),
    collisions,
  };
}
