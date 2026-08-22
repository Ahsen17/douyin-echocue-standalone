// Han-ideograph counting for the shared output validator (LLM §5.1). JS
// code-unit length is not equivalent to user-visible 汉字 count, so the display
// length limit (quick_reply ≤80, cue ≤40) is owned here, not by maxLength.
export const HAN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0x20000, 0x2a6df], // Extension B
  [0x2a700, 0x2b73f], // Extension C
  [0x2b740, 0x2b81f], // Extension D
  [0x2b820, 0x2ceaf], // Extension E
  [0x2ceb0, 0x2ebef], // Extension F
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0x2f800, 0x2fa1f], // Compatibility Supplement
];

function isHan(codePoint: number): boolean {
  for (const [lo, hi] of HAN_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

// Iterates code points (not UTF-16 code units), so a surrogate pair for an
// Extension-B han counts as 1. CJK punctuation and fullwidth/halfwidth forms
// are deliberately not counted as 汉字.
export function countHanCharacters(s: string): number {
  let count = 0;
  for (const ch of s) {
    if (isHan(ch.codePointAt(0) ?? 0)) count += 1;
  }
  return count;
}

// True when the string carries no non-punctuation/non-whitespace/non-control
// code point (a display field of only punctuation or whitespace is unusable).
const NON_MEANINGFUL = /^[\p{P}\p{Z}\p{C}]*$/u;

export function isOnlyPunctuationOrWhitespace(s: string): boolean {
  return NON_MEANINGFUL.test(s);
}
