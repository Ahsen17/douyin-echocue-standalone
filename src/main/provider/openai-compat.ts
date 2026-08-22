/**
 * OpenAI-compatible Chat Completions adapter base (M5-03 DeepSeek, M5-04 OpenAI-compatible).
 * Implements the TextGenerationProvider contract; SDK/wire differences never leak upward.
 */
import type { ProviderErrorV1 } from '@echocue/contracts';
import { fetchJson, ProviderTransportError, type FetchJsonInput } from './http.js';
import { extractProviderRequestId, parseProviderResponse } from './parse.js';
import type {
  ProviderAuditRecord,
  ProviderGenerateInput,
  ProviderGenerateResult,
  ProviderMessage,
} from './types.js';
import type { TextGenerationProvider } from './TextGenerationProvider.js';

export type OpenAiAdapterType = 'DEEPSEEK' | 'OPENAI_COMPATIBLE';

export interface OpenAiChatCompletionsAdapterOptions {
  adapterType: OpenAiAdapterType;
  /** Chat Completions endpoint, e.g. /chat/completions. */
  path?: string;
  /** Test seam: override the transport (e.g. loopback http). Defaults to the real fetchJson. */
  fetchJsonImpl?: (input: FetchJsonInput) => Promise<{ status: number; body: unknown; finalUrl: string }>;
}

export const CHAT_COMPLETIONS_PATH = '/chat/completions';

/** Build the MVP wire request (LLM §4.1): non-streaming JSON output, no tools. */
export function buildChatCompletionsRequest(input: ProviderGenerateInput): {
  model: string;
  stream: false;
  response_format: { type: 'json_object' };
  messages: ProviderMessage[];
} {
  return {
    model: input.modelId,
    stream: false,
    response_format: { type: 'json_object' },
    messages: input.messages,
  };
}

export class OpenAiChatCompletionsProvider implements TextGenerationProvider {
  readonly adapterType: OpenAiAdapterType;
  private readonly path: string;
  private readonly fetchImpl: (input: FetchJsonInput) => Promise<{
    status: number;
    body: unknown;
    finalUrl: string;
  }>;
  private lastAuditRecord: ProviderAuditRecord | null = null;

  constructor(options: OpenAiChatCompletionsAdapterOptions) {
    this.adapterType = options.adapterType;
    this.path = options.path ?? CHAT_COMPLETIONS_PATH;
    this.fetchImpl = options.fetchJsonImpl ?? fetchJson;
  }

  async generateReply(input: ProviderGenerateInput): Promise<ProviderGenerateResult> {
    const wireRequest = buildChatCompletionsRequest(input);
    try {
      const response = await this.fetchImpl({
        baseUrl: input.baseUrl,
        path: this.path,
        method: 'POST',
        body: wireRequest,
        apiKey: input.apiKey,
        timeoutMs: input.timeoutMs,
        abortSignal: input.abortSignal,
      });
      const result = parseProviderResponse({ status: response.status, body: response.body });
      this.lastAuditRecord = this.buildAuditRecord(input, wireRequest, response.body, result);
      return result;
    } catch (err) {
      if (err instanceof ProviderTransportError) {
        const code = transportErrorToProviderError(err.kind);
        // Transport failures still produce audit metadata (rawRequest + normalizedError).
        this.lastAuditRecord = this.buildAuditRecord(input, wireRequest, undefined, {
          ok: false,
          error: { code },
        });
        return { ok: false, error: { code } };
      }
      throw err;
    }
  }

  /** Audit record of the most recent call; rawRequest/rawResponse exclude the API key. */
  getAuditRecord(): ProviderAuditRecord | null {
    return this.lastAuditRecord;
  }

  /**
   * Build the audit metadata (CONTRACT §6 ProviderAuditRecord). Only white-listed
   * request payload fields are kept and any echo of the API key is scrubbed — the
   * key lives solely in the Authorization header and must never appear here.
   */
  buildAuditRecord(
    input: ProviderGenerateInput,
    wireRequest: ReturnType<typeof buildChatCompletionsRequest>,
    rawResponse: unknown,
    result: ProviderGenerateResult,
  ): ProviderAuditRecord {
    const record: ProviderAuditRecord = {
      providerId: input.providerId,
      adapterType: this.adapterType,
      baseUrlOrigin: new URL(input.baseUrl).origin,
      modelId: input.modelId,
      rawRequest: scrub(input.apiKey, wireRequest),
      ...(rawResponse !== undefined ? { rawResponse: scrub(input.apiKey, rawResponse) } : {}),
    };
    const requestId = extractProviderRequestId(rawResponse);
    if (requestId) record.providerRequestId = requestId;
    if (!result.ok) record.normalizedError = result.error.code;
    return record;
  }
}

/** Deep-scrub any string equal to the key from a JSON-serializable value. */
function scrub(apiKey: string, value: unknown): unknown {
  if (typeof value === 'string') return value.split(apiKey).join('[REDACTED]');
  if (Array.isArray(value)) return value.map((v) => scrub(apiKey, v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(apiKey, v);
    return out;
  }
  return value;
}

function transportErrorToProviderError(
  kind: 'NETWORK' | 'TIMEOUT' | 'ABORTED' | 'REDIRECT' | 'VALIDATION',
): ProviderErrorV1 {
  switch (kind) {
    case 'NETWORK':
      return 'NETWORK';
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'ABORTED':
      return 'ABORTED';
    case 'REDIRECT':
    case 'VALIDATION':
      return 'PROTOCOL';
  }
}
