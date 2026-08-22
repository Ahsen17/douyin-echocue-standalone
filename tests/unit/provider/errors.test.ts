import { describe, it, expect } from 'vitest';
import {
  mapHttpStatusToProviderError,
  mapProviderErrorToDomain,
  PROVIDER_ERRORS_V1,
} from '../../../src/main/provider/index.js';
import {
  ProviderErrorV1Schema,
  type DomainErrorV1,
  type ProviderErrorV1,
} from '@echocue/contracts';

describe('provider error mapping', () => {
  describe('mapHttpStatusToProviderError', () => {
    it('returns null for 2xx', () => {
      expect(mapHttpStatusToProviderError(200)).toBeNull();
      expect(mapHttpStatusToProviderError(204)).toBeNull();
    });

    it('maps 401 to AUTH', () => {
      expect(mapHttpStatusToProviderError(401)).toBe('AUTH');
    });

    it('maps 402 to BILLING', () => {
      expect(mapHttpStatusToProviderError(402)).toBe('BILLING');
    });

    it('maps 400 and 422 to VALIDATION', () => {
      expect(mapHttpStatusToProviderError(400)).toBe('VALIDATION');
      expect(mapHttpStatusToProviderError(422)).toBe('VALIDATION');
    });

    it('maps 429 to RATE_LIMIT', () => {
      expect(mapHttpStatusToProviderError(429)).toBe('RATE_LIMIT');
    });

    it('maps 5xx to SERVER', () => {
      expect(mapHttpStatusToProviderError(500)).toBe('SERVER');
      expect(mapHttpStatusToProviderError(503)).toBe('SERVER');
    });

    it('returns null for unhandled statuses (404, 403)', () => {
      expect(mapHttpStatusToProviderError(404)).toBeNull();
      expect(mapHttpStatusToProviderError(403)).toBeNull();
    });
  });

  describe('mapProviderErrorToDomain (CONTRACT §6 fixed mapping)', () => {
    const cases: Array<[ProviderErrorV1, DomainErrorV1 | null]> = [
      ['AUTH', 'E_PROVIDER_AUTH'],
      ['BILLING', 'E_PROVIDER_BILLING'],
      ['RATE_LIMIT', 'E_PROVIDER_RATE_LIMIT'],
      ['NETWORK', 'E_PROVIDER_NETWORK'],
      ['SERVER', 'E_PROVIDER_SERVER'],
      ['TIMEOUT', 'E_PROVIDER_TIMEOUT'],
      ['PROTOCOL', 'E_PROVIDER_PROTOCOL'],
      ['VALIDATION', 'E_PROVIDER_PROTOCOL'],
      ['OUTPUT_INVALID', 'E_PROVIDER_OUTPUT_INVALID'],
      ['ABORTED', null],
    ];

    it.each(cases)('maps %s to %s', (providerError, domainError) => {
      expect(mapProviderErrorToDomain(providerError)).toBe(domainError);
    });

    it('PROVIDER_ERRORS_V1 mirrors the shared schema so it can never drift', () => {
      expect(PROVIDER_ERRORS_V1).toEqual(ProviderErrorV1Schema.options);
    });
  });
});
