import { describe, it, expect } from 'vitest';
import { normalizeComment, COMMENT_NORMALIZER_VERSION } from '../../../src/main/safety/index.js';

describe('CommentNormalizerV1', () => {
  it('normalizes full-width to half-width via NFKC', () => {
    expect(normalizeComment('ＡＢＣ１２３')).toBe('abc123');
    expect(normalizeComment('你好，世界！')).toBe('你好,世界!');
  });

  it('collapses full-width spaces to a single space', () => {
    expect(normalizeComment('你好　世界')).toBe('你好 世界');
  });

  it('folds ASCII case', () => {
    expect(normalizeComment('Hello WORLD')).toBe('hello world');
  });

  it('collapses whitespace runs and trims', () => {
    expect(normalizeComment('  今天   状态  真好  ')).toBe('今天 状态 真好');
  });

  it('removes URLs', () => {
    expect(normalizeComment('看这个 https://example.com/abc?x=1 内容')).toBe('看这个 内容');
    expect(normalizeComment('链接 http://a.b/c')).toBe('链接');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeComment('   ')).toBe('');
    expect(normalizeComment('')).toBe('');
  });

  it('is idempotent', () => {
    const raw = '  你好　World  https://example.com/x   ';
    const once = normalizeComment(raw);
    expect(normalizeComment(once)).toBe(once);
  });

  it('declares a stable normalizer version', () => {
    expect(COMMENT_NORMALIZER_VERSION).toBe('CommentNormalizerV1');
  });
});
