/**
 * Provider error mapping (CONTRACT §6 / LLM §6).
 * HTTP/transport status → ProviderErrorV1 → DomainErrorV1. Fixed table, no free-form codes.
 */

import {
  ProviderErrorV1Schema,
  type DomainErrorV1,
  type ProviderErrorV1,
} from '@echocue/contracts';

/**
 * Map an HTTP status to ProviderErrorV1 (LLM §6).
 * Returns null for 2xx (not an error) and for statuses with no fixed mapping —
 * callers must check 2xx success before treating null as an error.
 */
export function mapHttpStatusToProviderError(status: number): ProviderErrorV1 | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return 'AUTH';
  if (status === 402) return 'BILLING';
  if (status === 400 || status === 422) return 'VALIDATION';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500 && status < 600) return 'SERVER';
  return null;
}

/**
 * Fixed provider→domain mapping (CONTRACT §6). ABORTED is deliberately excluded:
 * a caller-triggered abort is not a user-visible error — the workflow audits it as
 * DISCARDED with a specific reason instead of FAILED. The exhaustive Record type
 * forces any future ProviderErrorV1 member to be handled here at compile time.
 */
const PROVIDER_TO_DOMAIN: Record<Exclude<ProviderErrorV1, 'ABORTED'>, DomainErrorV1> = {
  AUTH: 'E_PROVIDER_AUTH',
  BILLING: 'E_PROVIDER_BILLING',
  RATE_LIMIT: 'E_PROVIDER_RATE_LIMIT',
  NETWORK: 'E_PROVIDER_NETWORK',
  SERVER: 'E_PROVIDER_SERVER',
  TIMEOUT: 'E_PROVIDER_TIMEOUT',
  PROTOCOL: 'E_PROVIDER_PROTOCOL',
  VALIDATION: 'E_PROVIDER_PROTOCOL',
  OUTPUT_INVALID: 'E_PROVIDER_OUTPUT_INVALID',
};

/**
 * Map a ProviderErrorV1 to its fixed domain error code. Returns null for ABORTED,
 * signalling the workflow should treat it as DISCARDED rather than FAILED.
 */
export function mapProviderErrorToDomain(code: ProviderErrorV1): DomainErrorV1 | null {
  if (code === 'ABORTED') return null;
  return PROVIDER_TO_DOMAIN[code];
}

/** All ProviderErrorV1 members, derived from the shared schema so it can never drift. */
export const PROVIDER_ERRORS_V1: readonly ProviderErrorV1[] = ProviderErrorV1Schema.options;

