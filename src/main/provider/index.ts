export { ProviderConfigService, DEEPSEEK_DEFAULT_BASE_URL } from './provider-config.js';
export type {
  ConnectionTestResult,
  ChatCompletionsProbe,
  ProviderGenerateInput,
  ProviderGenerateResult,
  ProviderGenerateOk,
  ProviderGenerateError,
  ProviderAuditRecord,
  ProviderMessage,
} from './types.js';
export { wireProviderControl } from './provider-control-ipc.js';
export type { ProviderControlIpcOptions } from './provider-control-ipc.js';
export { createProviderCredentialHandlers } from './provider-control-handlers.js';
export type { ProviderCredentialHandlers } from './provider-control-handlers.js';
export type { TextGenerationProvider } from './TextGenerationProvider.js';
export { DeepSeekProvider } from './deepseek.js';
export type { DeepSeekProviderOptions } from './deepseek.js';
export { OpenAiCompatibleProvider } from './openai-compatible.js';
export type { OpenAiCompatibleProviderOptions } from './openai-compatible.js';
export {
  OpenAiChatCompletionsProvider,
  buildChatCompletionsRequest,
  CHAT_COMPLETIONS_PATH,
} from './openai-compat.js';
export type { OpenAiChatCompletionsAdapterOptions, OpenAiAdapterType } from './openai-compat.js';
export { extractProviderRequestId, parseProviderResponse } from './parse.js';
export type { ProviderHttpResponse } from './parse.js';
export {
  mapHttpStatusToProviderError,
  mapProviderErrorToDomain,
  PROVIDER_ERRORS_V1,
} from './errors.js';
export {
  ProviderTransportError,
  assertSecureHttpsUrl,
  fetchJson,
  joinUrl,
  resolveRedirectUrl,
} from './http.js';
export type {
  FetchJsonInput,
  FetchJsonResponse,
  ProviderTransportErrorKind,
} from './http.js';
