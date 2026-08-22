/**
 * Provider-layer types (M5-01 config service; extended by M5-02 stable interface).
 * Shared contract enums are imported from @echocue/contracts — never redefined.
 */

import type {
  ProviderConfigV1,
  ProviderErrorV1,
  SuggestionOutputV1,
} from '@echocue/contracts';

export type { ConnectionTestResultV1 as ConnectionTestResult } from '@echocue/contracts';

/** Probe endpoint invoked by the connection test (UI §7.1 three-state result). */
export interface ChatCompletionsProbe {
  (input: {
    baseUrl: string;
    path: string;
    body: unknown;
    apiKey: string;
    timeoutMs: number;
  }): Promise<{ status: number }>;
}

/** A rendered system/user message pair; prompt assembly is owned by M5-05. */
export interface ProviderMessage {
  role: 'system' | 'user';
  content: string;
}

/**
 * Input to TextGenerationProvider.generateReply (CONTRACT §6 GenerateSuggestionRequest).
 * The API key is resolved by the caller and injected here; the adapter must never
 * include it in audit records, errors, or any returned value.
 */
export interface ProviderGenerateInput {
  sessionId: string;
  traceId: string;
  windowVersion: number;
  providerId: string;
  adapterType: ProviderConfigV1['adapterType'];
  baseUrl: string;
  modelId: string;
  messages: ProviderMessage[];
  apiKey: string;
  /** Hard per-call timeout (CONTRACT §6: 5000ms); required so adapters never degrade to unbounded waits. */
  timeoutMs: number;
  freshnessDeadlineMonotonicMs: number;
  abortSignal: AbortSignal;
}

export interface ProviderGenerateOk {
  ok: true;
  output: SuggestionOutputV1;
  providerRequestId?: string;
}

export interface ProviderGenerateError {
  ok: false;
  error: {
    code: ProviderErrorV1;
    providerStatus?: number;
    providerRequestId?: string;
  };
}

/** Unified generateReply result: SDK response objects never cross this boundary. */
export type ProviderGenerateResult = ProviderGenerateOk | ProviderGenerateError;

/**
 * Audit metadata for a provider call (CONTRACT §6 ProviderAuditRecord).
 * Deliberately excludes the API key / Authorization header and any secrets.
 */
export interface ProviderAuditRecord {
  providerRequestId?: string;
  providerId: string;
  adapterType: ProviderConfigV1['adapterType'];
  baseUrlOrigin: string;
  modelId: string;
  rawRequest: unknown;
  rawResponse?: unknown;
  normalizedError?: string;
}
