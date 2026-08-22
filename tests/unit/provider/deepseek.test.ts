import { describe, it, expect } from 'vitest';
import {
  DeepSeekProvider,
  buildChatCompletionsRequest,
  ProviderTransportError,
  type ProviderGenerateInput,
} from '../../../src/main/provider/index.js';

function makeInput(overrides: Partial<ProviderGenerateInput> = {}): ProviderGenerateInput {
  return {
    sessionId: 's',
    traceId: 't',
    windowVersion: 1,
    providerId: 'deepseek-primary',
    adapterType: 'DEEPSEEK',
    baseUrl: 'https://api.deepseek.com',
    modelId: 'deepseek-chat',
    messages: [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ],
    apiKey: 'sk-secret',
    timeoutMs: 5000,
    freshnessDeadlineMonotonicMs: 1000,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe('DeepSeekProvider', () => {
  it('builds the MVP chat/completions request without tools', () => {
    const req = buildChatCompletionsRequest(makeInput());
    expect(req).toEqual({
      model: 'deepseek-chat',
      stream: false,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
    });
    expect(JSON.stringify(req)).not.toContain('tools');
    expect(JSON.stringify(req)).not.toContain('tool_choice');
  });

  it('returns ok on a successful response', async () => {
    const provider = new DeepSeekProvider({
      fetchJsonImpl: async () => ({
        status: 200,
        body: { choices: [{ message: { content: '{"quick_reply":"你好","cues":["回应","互动"]}' } }] },
        finalUrl: 'https://api.deepseek.com/chat/completions',
      }),
    });
    const result = await provider.generateReply(makeInput());
    expect(result).toEqual({
      ok: true,
      output: { quick_reply: '你好', cues: ['回应', '互动'] },
    });
  });

  it('maps an HTTP 401 to an AUTH error', async () => {
    const provider = new DeepSeekProvider({
      fetchJsonImpl: async () => ({ status: 401, body: {}, finalUrl: 'x' }),
    });
    const result = await provider.generateReply(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUTH');
      expect(result.error.providerStatus).toBe(401);
    }
  });

  it('maps a transport timeout to a TIMEOUT error', async () => {
    const provider = new DeepSeekProvider({
      fetchJsonImpl: async () => {
        throw new ProviderTransportError('TIMEOUT', 'boom');
      },
    });
    const result = await provider.generateReply(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TIMEOUT');
  });

  it('maps an external abort to ABORTED', async () => {
    const provider = new DeepSeekProvider({
      fetchJsonImpl: async () => {
        throw new ProviderTransportError('ABORTED', 'aborted');
      },
    });
    const result = await provider.generateReply(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ABORTED');
  });

  it('maps a redirect violation to PROTOCOL', async () => {
    const provider = new DeepSeekProvider({
      fetchJsonImpl: async () => {
        throw new ProviderTransportError('REDIRECT', 'cross-host');
      },
    });
    const result = await provider.generateReply(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROTOCOL');
  });

  it('audit record never contains the API key', async () => {
    const provider = new DeepSeekProvider({
      fetchJsonImpl: async () => ({
        status: 200,
        body: { id: 'req-abc', choices: [{ message: { content: '{"quick_reply":"x","cues":["a","b"]}' } }] },
        finalUrl: 'x',
      }),
    });
    await provider.generateReply(makeInput({ apiKey: 'sk-super-secret' }));
    const audit = provider.getAuditRecord();
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit)).not.toContain('sk-super-secret');
    expect(JSON.stringify(audit)).not.toContain('authorization');
    expect(audit?.providerId).toBe('deepseek-primary');
    expect(audit?.adapterType).toBe('DEEPSEEK');
    expect(audit?.baseUrlOrigin).toBe('https://api.deepseek.com');
  });

  it('audit record captures providerRequestId from the response body', async () => {
    const provider = new DeepSeekProvider({
      fetchJsonImpl: async () => ({
        status: 200,
        body: { id: 'req-xyz', choices: [{ message: { content: '{"quick_reply":"x","cues":["a","b"]}' } }] },
        finalUrl: 'x',
      }),
    });
    const result = await provider.generateReply(makeInput());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.providerRequestId).toBe('req-xyz');
  });

  it('audit record fills normalizedError on an HTTP error', async () => {
    const provider = new DeepSeekProvider({
      fetchJsonImpl: async () => ({ status: 401, body: {}, finalUrl: 'x' }),
    });
    const result = await provider.generateReply(makeInput());
    expect(result.ok).toBe(false);
    const audit = provider.getAuditRecord();
    expect(audit?.normalizedError).toBe('AUTH');
  });

  it('audit record exists even when the transport throws', async () => {
    const provider = new DeepSeekProvider({
      fetchJsonImpl: async () => {
        throw new ProviderTransportError('TIMEOUT', 'boom');
      },
    });
    const result = await provider.generateReply(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TIMEOUT');
    const audit = provider.getAuditRecord();
    expect(audit).not.toBeNull();
    expect(audit?.normalizedError).toBe('TIMEOUT');
    expect(JSON.stringify(audit)).not.toContain('sk-secret');
  });

  it('audit record scrubs an apiKey echoed back in rawResponse', async () => {
    const provider = new DeepSeekProvider({
      fetchJsonImpl: async () => ({
        status: 200,
        body: {
          id: 'req-echo',
          choices: [{ message: { content: `{"quick_reply":"x","cues":["a","b"]} key=sk-secret` } }],
        },
        finalUrl: 'x',
      }),
    });
    const result = await provider.generateReply(makeInput({ apiKey: 'sk-secret' }));
    expect(result.ok).toBe(false); // echoed key pollutes JSON content → OUTPUT_INVALID
    const audit = provider.getAuditRecord();
    expect(JSON.stringify(audit)).not.toContain('sk-secret');
    expect(JSON.stringify(audit)).toContain('[REDACTED]');
  });
});
