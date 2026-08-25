// Regex→NFKC→case→whitespace normalization shared by the input safety filter
// and member routing. The raw message is preserved by the caller for audit.
const URL_RE = /https?:\/\/\S+/g;
// Douyin emoji placeholders are bracketed words (e.g. [点赞]); they are not
// part of the danmaku body and must not pollute routing/retrieval/prompt.
const EMOJI_PLACEHOLDER_RE = /\[[^\[\]]+\]/g;
// Drop every whitespace run except the single space that follows an @username
// (a mention boundary); the capture group re-emits that one space.
const COMPACT_WS_RE = /(@\S+)\s|\s+/g;

export const COMMENT_NORMALIZER_VERSION = 'CommentNormalizerV1' as const;

// Deterministic per raw text; idempotent. Never mutates the audit raw text.
export function normalizeComment(rawText: string): string {
  const noUrl = rawText.replace(URL_RE, ' ');
  const nfkc = noUrl.normalize('NFKC');
  const lower = nfkc.toLowerCase();
  const noEmoji = lower.replace(EMOJI_PLACEHOLDER_RE, '');
  return noEmoji.replace(COMPACT_WS_RE, (m, atUser) => (atUser ? `${atUser} ` : '')).trim();
}
