import { describe, expect, it } from 'vitest';
import { tokenId } from '../../../src/main/retrieval/index.js';
import { FIXTURES, loadJsonFixture } from '../../fixtures/loader.js';

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

describe('tokenId (MurmurHash3 x86 32-bit over UTF-8 bytes)', () => {
  it('matches the Python mmh3 reference for every fixture token', () => {
    expect(fixture.tokens.length).toBeGreaterThan(0);
    for (const row of fixture.tokens) {
      expect(tokenId(row.token), `token: ${row.token}`).toBe(row.pythonIndex);
    }
  });

  it('hashes the UTF-8 byte encoding of the token', () => {
    for (const row of fixture.tokens) {
      expect(Buffer.from(row.token, 'utf8').toString('hex')).toBe(row.utf8hex);
    }
  });

  it('covers Chinese, ASCII and emoji tokens', () => {
    const has = (re: RegExp) => fixture.tokens.some((r) => re.test(r.token));
    expect(has(/\p{Script=Han}/u)).toBe(true);
    expect(has(/^[\x20-\x7E]+$/u)).toBe(true);
    expect(has(/\p{Extended_Pictographic}/u)).toBe(true);
  });
});
