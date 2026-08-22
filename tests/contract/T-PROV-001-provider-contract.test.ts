import { describe, it, expect } from 'vitest';
import {
  ProviderFixtureCaseV1Schema,
  ProviderFixtureExpectedV1Schema,
  type ProviderFixtureCaseV1,
} from '@echocue/contracts';
import { loadJsonFixture, FIXTURES } from '../fixtures/loader.js';
import {
  DeepSeekProvider,
  parseProviderResponse,
  ProviderTransportError,
} from '../../src/main/provider/index.js';
import type { ProviderGenerateInput } from '../../src/main/provider/index.js';

const fixture = loadJsonFixture<{ schemaVersion: number; note: string; cases: ProviderFixtureCaseV1[] }>(
  FIXTURES.PROVIDER_CONTRACT,
);

function findCase(id: string): ProviderFixtureCaseV1 {
  const found = fixture.cases.find((c) => c.id === id);
  expect(found, `fixture missing case ${id}`).toBeDefined();
  return found as ProviderFixtureCaseV1;
}

function makeInput(overrides: Partial<ProviderGenerateInput> = {}): ProviderGenerateInput {
  return {
    sessionId: 's',
    traceId: 't',
    windowVersion: 1,
    providerId: 'deepseek-primary',
    adapterType: 'DEEPSEEK',
    baseUrl: 'https://api.deepseek.com',
    modelId: 'm',
    messages: [{ role: 'user', content: 'ping' }],
    apiKey: 'sk-test',
    timeoutMs: 5000,
    freshnessDeadlineMonotonicMs: 1000,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe('T-PROV-001: Provider Contract Fixtures', () => {
  it('should load provider contract fixture', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
    expect(fixture.schemaVersion).toBe(1);
  });

  // M-1: the machine-readable schema must accept every authoritative fixture case,
  // so schema and fixture cannot silently drift.
  it('every fixture case satisfies ProviderFixtureCaseV1Schema', () => {
    for (const c of fixture.cases) {
      const parsed = ProviderFixtureCaseV1Schema.safeParse(c);
      expect(parsed.success, `fixture case ${c.id} violates ProviderFixtureCaseV1Schema`).toBe(true);
    }
  });

  it('every fixture expected block satisfies ProviderFixtureExpectedV1Schema', () => {
    for (const c of fixture.cases) {
      const parsed = ProviderFixtureExpectedV1Schema.safeParse(c.expected);
      expect(parsed.success, `fixture case ${c.id} expected block is invalid`).toBe(true);
    }
  });

  it('should validate DeepSeek success case', () => {
    const c = findCase('deepseek-json-success');
    const result = parseProviderResponse({
      status: c.response?.status ?? 200,
      body: c.response?.body,
    });
    expect(result).toEqual({
      ok: true,
      output: { quick_reply: c.expected.quick_reply, cues: c.expected.cues },
      providerRequestId: 'provider-request-id',
    });
  });

  it('should validate OpenAI-compatible success case', () => {
    const c = findCase('openai-compatible-json-success');
    const result = parseProviderResponse({
      status: c.response?.status ?? 200,
      body: c.response?.body,
    });
    expect(result).toEqual({
      ok: true,
      output: { quick_reply: c.expected.quick_reply, cues: c.expected.cues },
      providerRequestId: 'compatible-request-id',
    });
  });

  it('should reject tool_calls with E_PROVIDER_PROTOCOL', () => {
    const c = findCase('tool-calls-rejected-in-mvp');
    expect(c.expected.providerError).toBe('PROTOCOL');
    expect(c.expected.domainError).toBe('E_PROVIDER_PROTOCOL');
    const result = parseProviderResponse({
      status: c.response?.status ?? 200,
      body: c.response?.body,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROTOCOL');
  });

  it('should handle timeout with E_PROVIDER_TIMEOUT', async () => {
    const c = findCase('provider-timeout');
    expect(c.response?.abortAtMs).toBe(5000);
    expect(c.expected.providerError).toBe('TIMEOUT');
    expect(c.expected.domainError).toBe('E_PROVIDER_TIMEOUT');
    expect(c.expected.retry).toBe(false);
    // M-3: drive the real adapter so the timeout path is exercised, not just asserted.
    const provider = new DeepSeekProvider({
      fetchJsonImpl: async () => {
        throw new ProviderTransportError('TIMEOUT', 'fixture timeout');
      },
    });
    const result = await provider.generateReply(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TIMEOUT');
  });

  it('should reject invalid output with E_PROVIDER_OUTPUT_INVALID', () => {
    const c = findCase('invalid-output');
    expect(c.expected.providerError).toBe('OUTPUT_INVALID');
    expect(c.expected.domainError).toBe('E_PROVIDER_OUTPUT_INVALID');
    const result = parseProviderResponse({
      status: c.response?.status ?? 200,
      body: c.response?.body,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('OUTPUT_INVALID');
  });
});
