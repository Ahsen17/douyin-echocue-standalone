/**
 * DeepSeek provider (M5-03). First adapter over the shared OpenAI-compatible base;
 * uses DeepSeek's OpenAI-compatible Chat Completions subset (RESEARCH §5.4, LLM §4).
 */
import { OpenAiChatCompletionsProvider, type OpenAiChatCompletionsAdapterOptions } from './openai-compat.js';

export type DeepSeekProviderOptions = Pick<OpenAiChatCompletionsAdapterOptions, 'fetchJsonImpl'>;

export class DeepSeekProvider extends OpenAiChatCompletionsProvider {
  constructor(options: DeepSeekProviderOptions = {}) {
    super({ adapterType: 'DEEPSEEK', ...options });
  }
}
