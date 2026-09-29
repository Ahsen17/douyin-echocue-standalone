import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createBm25TextPipeline } from '../../../src/main/retrieval/index.js';
import {
  CHINESE_STOP_WORDS_V2,
  STOP_WORDS_SHA256_V2,
} from '../../../src/main/retrieval/stopwords.generated.js';

const pipeline = createBm25TextPipeline();

describe('stop-word filtered tokenization', () => {
  it('drops high-frequency function words from indexed tokens', () => {
    const tokens = pipeline.tokenize(pipeline.normalize('主播今天状态真好'));
    expect(tokens).toContain('主播');
    expect(tokens).not.toContain('的');
    expect(tokens).not.toContain('了');
    expect(tokens).not.toContain('是');
    expect(tokens).not.toContain('吗');
  });

  it('filters the query side identically to the index side', () => {
    const text = '主播今天状态真好，太有活力了';
    const query = pipeline.queryTokens(text);
    const indexed = pipeline.tokenize(pipeline.normalize(text));
    expect(query).toEqual([...new Set(indexed)]);
  });

  it('keeps multi-char tokens that merely contain a stop word (whole-token match)', () => {
    for (const text of ['好活', '上分', '不行']) {
      const tokens = pipeline.tokenize(pipeline.normalize(text));
      expect(tokens).toContain(text);
    }
    const tokens = pipeline.tokenize(pipeline.normalize('长线外挂'));
    expect(tokens).toEqual(['长线', '外挂']);
  });

  it('keeps content-bearing single chars that were curated out of the stop list', () => {
    for (const token of ['好', '大', '快', '看', '纯']) {
      expect(pipeline.tokenize(pipeline.normalize(token))).toContain(token);
      expect(CHINESE_STOP_WORDS_V2).not.toContain(token);
    }
  });

  it('yields an empty analysis for stop-word-only or punctuation-only text', () => {
    const analyzed = pipeline.analyze('的吗了吧呢');
    expect(analyzed.tokens).toEqual([]);
    expect(analyzed.docLen).toBe(0);
    expect(analyzed.tf.size).toBe(0);
    expect(pipeline.queryTokens('的吗了吧呢')).toEqual([]);
  });

  it('produces deterministic tokens across calls', () => {
    const a = pipeline.analyze('主播今天状态真好，太有活力了');
    const b = pipeline.analyze('主播今天状态真好，太有活力了');
    expect(a.tokens).toEqual(b.tokens);
    expect(a.docLen).toBe(b.docLen);
  });
});

describe('generated stop-word module integrity', () => {
  it('matches the sha256 of its sorted word list', () => {
    const sha = createHash('sha256').update(CHINESE_STOP_WORDS_V2.join('\n'), 'utf8').digest('hex');
    expect(sha).toBe(STOP_WORDS_SHA256_V2);
  });

  it('is derived from the committed curated source file', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const source = readFileSync(join(root, 'assets', 'stopwords-curated.txt'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && /\p{Script=Han}|\p{L}|\p{N}|\p{Extended_Pictographic}/u.test(l));
    expect([...new Set(source)].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))).toEqual([
      ...CHINESE_STOP_WORDS_V2,
    ]);
  });

  it('holds no empty entries, duplicates, or pure-symbol lines', () => {
    expect(CHINESE_STOP_WORDS_V2.length).toBeGreaterThan(0);
    expect(new Set(CHINESE_STOP_WORDS_V2).size).toBe(CHINESE_STOP_WORDS_V2.length);
    for (const word of CHINESE_STOP_WORDS_V2) {
      expect(word.length).toBeGreaterThan(0);
      expect(word).toMatch(/\p{Script=Han}|\p{L}|\p{N}|\p{Extended_Pictographic}/u);
    }
  });
});
