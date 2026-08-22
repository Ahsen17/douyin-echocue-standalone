/**
 * DeepSeek provider. Uses DeepSeek's OpenAI-compatible Chat Completions subset
 * over the shared base (RESEARCH §5.4, LLM §4).
 */
import { OpenAiChatCompletionsProvider, type OpenAiChatCompletionsAdapterOptions } from './openai-compat.js';

export type DeepSeekProviderOptions = Pick<OpenAiChatCompletionsAdapterOptions, 'fetchJsonImpl'>;

export class DeepSeekProvider extends OpenAiChatCompletionsProvider {
  constructor(options: DeepSeekProviderOptions = {}) {
    super({ adapterType: 'DEEPSEEK', ...options });
  }
}
