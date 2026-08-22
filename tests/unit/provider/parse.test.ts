import { describe, it, expect } from 'vitest';
import { parseProviderResponse } from '../../../src/main/provider/index.js';
import { loadJsonFixture, FIXTURES } from '../../fixtures/loader.js';

interface ProviderFixtureCase {
  id: string;
  adapterType?: 'DEEPSEEK' | 'OPENAI_COMPATIBLE';
  config?: Record<string, unknown>;
  request?: unknown;
  response?: { status?: number; body?: unknown; abortAtMs?: number };
  expected: {
    ok: boolean;
    quick_reply?: string;
    cues?: string[];
    providerError?: string;
    domainError?: string;
    retry?: boolean;
  };
}

interface ProviderFixture {
  schemaVersion: number;
  note: string;
  cases: ProviderFixtureCase[];
}

const fixture = loadJsonFixture<ProviderFixture>(FIXTURES.PROVIDER_CONTRACT);

describe('provider response parsing', () => {
  it('parses a successful DeepSeek JSON response', () => {
    const result = parseProviderResponse({
      status: 200,
      body: {
        id: 'provider-request-id',
        choices: [{ message: { content: '{"quick_reply":"谢谢你一直在呀","cues":["回应陪伴","自然带动互动"]}' } }],
      },
    });
    expect(result).toEqual({
      ok: true,
      output: { quick_reply: '谢谢你一直在呀', cues: ['回应陪伴', '自然带动互动'] },
      providerRequestId: 'provider-request-id',
    });
  });

  it('rejects a tool_calls response with PROTOCOL', () => {
    const result = parseProviderResponse({
      status: 200,
      body: { choices: [{ message: { content: null, tool_calls: [{ id: 'call-1', type: 'function' }] } }] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROTOCOL');
  });

  it('rejects content that is missing or non-string with PROTOCOL', () => {
    const nullContent = parseProviderResponse({ status: 200, body: { choices: [{ message: { content: null } }] } });
    const emptyBody = parseProviderResponse({ status: 200, body: {} });
    expect(nullContent.ok).toBe(false);
    expect(emptyBody.ok).toBe(false);
    if (!nullContent.ok) expect(nullContent.error.code).toBe('PROTOCOL');
  });

  it('rejects invalid JSON content with OUTPUT_INVALID', () => {
    const result = parseProviderResponse({
      status: 200,
      body: { choices: [{ message: { content: 'not json' } }] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('OUTPUT_INVALID');
  });

  it('rejects JSON that fails the suggestion schema with OUTPUT_INVALID', () => {
    const result = parseProviderResponse({
      status: 200,
      body: { choices: [{ message: { content: '{"quick_reply":"只有回复，没有提词"}' } }] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('OUTPUT_INVALID');
  });

  it('maps an HTTP 401 to AUTH', () => {
    const result = parseProviderResponse({ status: 401, body: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUTH');
      expect(result.error.providerStatus).toBe(401);
    }
  });

  it('maps an HTTP 429 to RATE_LIMIT', () => {
    const result = parseProviderResponse({ status: 429, body: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RATE_LIMIT');
  });

  it('maps an HTTP 503 to SERVER', () => {
    const result = parseProviderResponse({ status: 503, body: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SERVER');
  });

  it('maps an unmapped HTTP status (403) to PROTOCOL', () => {
    const result = parseProviderResponse({ status: 403, body: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROTOCOL');
      expect(result.error.providerStatus).toBe(403);
    }
  });
});
