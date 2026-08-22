/**
 * Shared provider response parsing (M5-03 DeepSeek, reused by M5-04 OpenAI-compatible).
 * Pure and I/O-free so the contract fixtures can drive it directly.
 */
import { SuggestionOutputV1Schema } from '@echocue/contracts';
import type { ProviderGenerateResult } from './types.js';
import { mapHttpStatusToProviderError } from './errors.js';

export interface ProviderHttpResponse {
  status: number;
  body: unknown;
}

/**
 * Parse a chat/completions response into a unified result (LLM §4.2 / CONTRACT §6).
 * - 2xx + valid JSON content → ok
 * - tool_calls present or non-string content → PROTOCOL
 * - unparseable/invalid JSON content → OUTPUT_INVALID
 * - non-2xx → mapped by HTTP status
 */
export function parseProviderResponse(response: ProviderHttpResponse): ProviderGenerateResult {
  const providerRequestId = extractProviderRequestId(response.body);
  if (response.status < 200 || response.status >= 300) {
    const code = mapHttpStatusToProviderError(response.status);
    if (!code) return { ok: false, error: { code: 'PROTOCOL', providerStatus: response.status, providerRequestId } };
    return { ok: false, error: { code, providerStatus: response.status, providerRequestId } };
  }

  const content = extractContent(response.body);
  if (content === undefined) {
    // tool_calls or a message without text JSON → protocol violation (MVP rejects tools)
    return { ok: false, error: { code: 'PROTOCOL', providerStatus: response.status, providerRequestId } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, error: { code: 'OUTPUT_INVALID', providerStatus: response.status, providerRequestId } };
  }

  const validated = SuggestionOutputV1Schema.safeParse(parsed);
  if (!validated.success) {
    return { ok: false, error: { code: 'OUTPUT_INVALID', providerStatus: response.status, providerRequestId } };
  }

  return { ok: true, output: validated.data, providerRequestId };
}

/** Extract provider request id from a chat/completions body, if present. */
export function extractProviderRequestId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const id = (body as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Extract the text content of choices[0].message.content.
 * Returns undefined when content is absent, null, or non-string (incl. tool_calls).
 */
function extractContent(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const message = (choices[0] as { message?: unknown } | undefined)?.message;
  if (typeof message !== 'object' || message === null) return undefined;
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' && content.length > 0 ? content : undefined;
}
