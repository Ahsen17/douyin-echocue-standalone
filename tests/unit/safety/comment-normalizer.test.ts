import { describe, it, expect } from 'vitest';
import { normalizeComment, COMMENT_NORMALIZER_VERSION } from '../../../src/main/safety/index.js';

describe('CommentNormalizerV1', () => {
  it('normalizes full-width to half-width via NFKC', () => {
    expect(normalizeComment('ＡＢＣ１２３')).toBe('abc123');
    expect(normalizeComment('你好，世界！')).toBe('你好,世界!');
  });

  it('removes all spaces and newlines', () => {
    expect(normalizeComment('你好　世界')).toBe('你好世界');
    expect(normalizeComment('  今天   状态  真好  ')).toBe('今天状态真好');
    expect(normalizeComment('你好\n世界')).toBe('你好世界');
    expect(normalizeComment('今天\r\n明天')).toBe('今天明天');
  });

  it('keeps the single space after an @username', () => {
    expect(normalizeComment('@主播 大家好 今天真棒')).toBe('@主播 大家好今天真棒');
    expect(normalizeComment('你好 @嘉宾 再见')).toBe('你好@嘉宾 再见');
    expect(normalizeComment('@主播')).toBe('@主播');
  });

  it('strips bracketed emoji placeholders', () => {
    expect(normalizeComment('[点赞] 大家好')).toBe('大家好');
    expect(normalizeComment('[点赞] @主播 大家好')).toBe('@主播 大家好');
    expect(normalizeComment('大家好[666]今天')).toBe('大家好今天');
  });

  it('returns an empty string for emoji/whitespace-only input', () => {
    expect(normalizeComment('[点赞][666]')).toBe('');
    expect(normalizeComment('[点赞]')).toBe('');
    expect(normalizeComment('   ')).toBe('');
    expect(normalizeComment('')).toBe('');
  });

  it('folds ASCII case', () => {
    expect(normalizeComment('Hello WORLD')).toBe('helloworld');
  });

  it('removes URLs', () => {
    expect(normalizeComment('看这个 https://example.com/abc?x=1 内容')).toBe('看这个内容');
    expect(normalizeComment('链接 http://a.b/c')).toBe('链接');
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
