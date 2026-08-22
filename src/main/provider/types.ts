/**
 * Provider-layer types (M5-01 config service; extended by M5-02 stable interface).
 * Shared contract enums are imported from @echocue/contracts — never redefined.
 */

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
