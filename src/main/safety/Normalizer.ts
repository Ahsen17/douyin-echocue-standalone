// Regex→NFKC→case→whitespace normalization shared by the input safety filter
// and member routing. The raw message is preserved by the caller for audit.
const URL_RE = /https?:\/\/\S+/g;

export const COMMENT_NORMALIZER_VERSION = 'CommentNormalizerV1' as const;

// Deterministic per raw text; idempotent. Never mutates the audit raw text.
export function normalizeComment(rawText: string): string {
  const noUrl = rawText.replace(URL_RE, ' ');
  const nfkc = noUrl.normalize('NFKC');
  const lower = nfkc.toLowerCase();
  return lower.replace(/\s+/g, ' ').trim();
}
