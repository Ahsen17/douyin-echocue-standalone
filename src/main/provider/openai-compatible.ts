/**
 * OpenAI-compatible alternative adapter. Reuses the shared Chat Completions base
 * to prove the business layer has no vendor hard-binding (RESEARCH §5.2/§5.3):
 * only the provider-supported Chat Completions + JSON Output subset is used, never
 * Responses API / Tool Calls.
 */
import { OpenAiChatCompletionsProvider, type OpenAiChatCompletionsAdapterOptions } from './openai-compat.js';

export type OpenAiCompatibleProviderOptions = Pick<OpenAiChatCompletionsAdapterOptions, 'fetchJsonImpl'>;

export class OpenAiCompatibleProvider extends OpenAiChatCompletionsProvider {
  constructor(options: OpenAiCompatibleProviderOptions = {}) {
    super({ adapterType: 'OPENAI_COMPATIBLE', ...options });
  }
}
