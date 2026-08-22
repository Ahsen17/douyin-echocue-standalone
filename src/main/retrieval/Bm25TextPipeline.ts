import { cut_for_search } from 'jieba-wasm';
import { BM25_TOKENIZER_VERSION_V1 } from '@echocue/contracts';
import type { Bm25Analysis } from './types.js';

export const BM25_NORMALIZATION_VERSION_V1 = 'zh_bm25_normalize_v1';

// Versioned hotword/synonym map; POC-calibrated. Longest key applied first.
const DEFAULT_HOTWORD_MAP_V1: Readonly<Record<string, string>> = {};

const CONTROL_NON_WS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;
const WHITESPACE_RE = /\s+/g;

export interface Bm25TextPipelineOptions {
  hotwordMap?: Readonly<Record<string, string>>;
}

function isMeaningfulChar(ch: string): boolean {
  return (
    /\p{Script=Han}/u.test(ch) ||
    /\p{L}/u.test(ch) ||
    /\p{N}/u.test(ch) ||
    /\p{Extended_Pictographic}/u.test(ch)
  );
}

function isKeepableToken(token: string): boolean {
  for (const ch of token) {
    if (isMeaningfulChar(ch)) return true;
  }
  return false;
}

export interface Bm25TextPipeline {
  readonly tokenizerVersion: typeof BM25_TOKENIZER_VERSION_V1;
  readonly normalizationVersion: typeof BM25_NORMALIZATION_VERSION_V1;
  normalize(text: string): string;
  tokenize(normalized: string): string[];
  analyze(text: string): Bm25Analysis;
  queryTokens(text: string): string[];
}

export function createBm25TextPipeline(
  options: Bm25TextPipelineOptions = {},
): Bm25TextPipeline {
  const hotwordEntries = Object.entries(
    options.hotwordMap ?? DEFAULT_HOTWORD_MAP_V1,
  ).sort((a, b) => b[0].length - a[0].length);

  function normalize(text: string): string {
    let out = text.replace(CONTROL_NON_WS_RE, '').normalize('NFKC');
    out = out.replace(WHITESPACE_RE, ' ').trim();
    for (const [from, to] of hotwordEntries) {
      out = out.split(from).join(to);
    }
    return out;
  }

  function tokenize(normalized: string): string[] {
    return cut_for_search(normalized).filter(isKeepableToken);
  }

  function analyze(text: string): Bm25Analysis {
    const tokens = tokenize(normalize(text));
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }
    return { tokens, tf, docLen: tokens.length };
  }

  function queryTokens(text: string): string[] {
    return [...new Set(tokenize(normalize(text)))];
  }

  return {
    tokenizerVersion: BM25_TOKENIZER_VERSION_V1,
    normalizationVersion: BM25_NORMALIZATION_VERSION_V1,
    normalize,
    tokenize,
    analyze,
    queryTokens,
  };
}
