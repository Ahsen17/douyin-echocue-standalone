import { describe, expect, it } from 'vitest';
import { Bm25ZhJiebaProfileV1Schema } from '@echocue/contracts';
import { tokenId } from '../../src/main/retrieval/index.js';
import { FIXTURES, loadJsonFixture } from '../fixtures/loader.js';

interface Bm25HashFixtureRow {
  token: string;
  utf8hex: string;
  pythonIndex: number;
}

interface Bm25HashFixture {
  version: string;
  algorithm: string;
  pythonPackage: string;
  tokens: Bm25HashFixtureRow[];
}

const fixture = loadJsonFixture<Bm25HashFixture>(FIXTURES.BM25_HASH_FIXTURES);

describe('T-RET-001 cross-language token index fixture', () => {
  it('TypeScript tokenId equals the Python mmh3 reference index for every token', () => {
    expect(fixture.tokens.length).toBeGreaterThan(0);
    for (const row of fixture.tokens) {
      expect(tokenId(row.token), `token: ${row.token}`).toBe(row.pythonIndex);
    }
  });

  it('records the algorithm and producing package for reproducibility', () => {
    expect(fixture.algorithm).toBe('abs(MurmurHash3_x86_32(UTF-8, seed=0))');
    expect(fixture.pythonPackage).toMatch(/^mmh3 /);
    expect(fixture.version).toBe('1');
  });
});

describe('T-RET-001 Bm25ZhJiebaProfileV1 schema', () => {
  const validProfile = {
    profileId: 'bm25-zh-jieba-v1-0001',
    tokenizerVersion: 'zh_jieba_search_v1',
    normalizationVersion: 'zh_bm25_normalize_v1',
    preSetSha256: 'a'.repeat(64),
    avgDocLenBaseline: 12.5,
    k1: 1.2,
    b: 0.75,
    qdrantVersion: '1.19.0',
    calibrationArtifactId: 'cal-bm25-001',
  };

  it('accepts a frozen profile with FastEmbed defaults', () => {
    expect(Bm25ZhJiebaProfileV1Schema.safeParse(validProfile).success).toBe(true);
  });

  it('rejects a non-canonical tokenizer version', () => {
    const bad = { ...validProfile, tokenizerVersion: 'zh_jieba_search_v2' };
    expect(Bm25ZhJiebaProfileV1Schema.safeParse(bad).success).toBe(false);
  });

  it('rejects out-of-range parameters and malformed sha', () => {
    expect(Bm25ZhJiebaProfileV1Schema.safeParse({ ...validProfile, b: 1.5 }).success).toBe(false);
    expect(Bm25ZhJiebaProfileV1Schema.safeParse({ ...validProfile, k1: 0 }).success).toBe(false);
    expect(Bm25ZhJiebaProfileV1Schema.safeParse({ ...validProfile, avgDocLenBaseline: 0 }).success).toBe(false);
    expect(Bm25ZhJiebaProfileV1Schema.safeParse({ ...validProfile, preSetSha256: 'zz' }).success).toBe(false);
  });
});
