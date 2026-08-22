import { describe, expect, it } from 'vitest';
import {
  countHanCharacters,
  isOnlyPunctuationOrWhitespace,
} from '../../../src/main/util/index.js';

describe('countHanCharacters', () => {
  it('counts BMP han as 1 each', () => {
    expect(countHanCharacters('谢谢你')).toBe(3);
    expect(countHanCharacters('一二三四五')).toBe(5);
  });

  it('counts an Extension-B surrogate pair as 1, not 2 code units', () => {
    // U+20000 (CJK Ext B) is a surrogate pair in UTF-16.
    expect('𠀀'.length).toBe(2);
    expect(countHanCharacters('𠀀')).toBe(1);
    expect(countHanCharacters('𠀀𠀀𠀀')).toBe(3);
  });

  it('does not count ASCII as han', () => {
    expect(countHanCharacters('hello 123')).toBe(0);
    expect(countHanCharacters('abc谢谢你')).toBe(3);
  });

  it('does not count CJK punctuation or fullwidth forms as han', () => {
    expect(countHanCharacters('，。！？')).toBe(0);
    expect(countHanCharacters('ＡＢＣ')).toBe(0);
    expect(countHanCharacters('谢谢你，很好！')).toBe(5);
  });

  it('counts 80 han and rejects an 81st at the boundary', () => {
    expect(countHanCharacters('汉'.repeat(80))).toBe(80);
    expect(countHanCharacters('汉'.repeat(81))).toBe(81);
  });

  it('does not count emoji as han', () => {
    expect(countHanCharacters('🎉🎈')).toBe(0);
    expect(countHanCharacters('谢谢你🎉')).toBe(3);
  });

  it('counts compatibility han ideographs as han', () => {
    // U+F900 CJK Compatibility Ideograph
    expect(countHanCharacters('豈')).toBe(1);
  });
});

describe('isOnlyPunctuationOrWhitespace', () => {
  it('returns true for only punctuation or whitespace', () => {
    expect(isOnlyPunctuationOrWhitespace('！！！')).toBe(true);
    expect(isOnlyPunctuationOrWhitespace(' ... ')).toBe(true);
    expect(isOnlyPunctuationOrWhitespace('   ')).toBe(true);
    expect(isOnlyPunctuationOrWhitespace('')).toBe(true);
  });

  it('returns false when a meaningful code point is present', () => {
    expect(isOnlyPunctuationOrWhitespace('谢谢你')).toBe(false);
    expect(isOnlyPunctuationOrWhitespace('一！')).toBe(false);
    expect(isOnlyPunctuationOrWhitespace('a.')).toBe(false);
  });
});
