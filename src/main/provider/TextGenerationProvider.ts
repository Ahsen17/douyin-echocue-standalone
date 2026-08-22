/**
 * TextGenerationProvider stable interface (M5-02).
 * Business code depends only on this contract (LLM §2 / CONTRACT §6); concrete
 * SDK types must never cross the adapter boundary.
 */
import type { ProviderConfigV1 } from '@echocue/contracts';
import type { ProviderGenerateInput, ProviderGenerateResult } from './types.js';

export interface TextGenerationProvider {
  readonly adapterType: ProviderConfigV1['adapterType'];
  /** Single-shot structured JSON generation; never re-entrant tool calls. */
  generateReply(input: ProviderGenerateInput): Promise<ProviderGenerateResult>;
}
