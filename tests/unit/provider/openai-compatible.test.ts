import { describe, it, expect } from 'vitest';
import {
  OpenAiCompatibleProvider,
  DeepSeekProvider,
  ProviderTransportError,
  buildChatCompletionsRequest,
  type ProviderGenerateInput,
} from '../../../src/main/provider/index.js';

function makeInput(overrides: Partial<ProviderGenerateInput> = {}): ProviderGenerateInput {
  return {
    sessionId: 's',
    traceId: 't',
    windowVersion: 1,
    providerId: 'compatible-backup',
    adapterType: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://llm.example.invalid/v1',
    modelId: 'configured-compatible-model',
    messages: [{ role: 'user', content: 'hi' }],
    apiKey: 'sk-secret',
    timeoutMs: 5000,
    freshnessDeadlineMonotonicMs: 1000,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe('OpenAiCompatibleProvider', () => {
  it('uses the OPENAI_COMPATIBLE adapterType', () => {
    expect(new OpenAiCompatibleProvider().adapterType).toBe('OPENAI_COMPATIBLE');
  });

  it('builds the MVP chat/completions request without tools or tool_choice', () => {
    const input = makeInput();
    const req = buildChatCompletionsRequest(input);
    expect(req).toEqual({
      model: 'configured-compatible-model',
      stream: false,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(JSON.stringify(req)).not.toContain('tools');
    expect(JSON.stringify(req)).not.toContain('tool_choice');
  });

  it('parses a successful response into a structured result', async () => {
    const provider = new OpenAiCompatibleProvider({
      fetchJsonImpl: async () => ({
        status: 200,
        body: {
          id: 'compatible-request-id',
          choices: [{ message: { content: '{"quick_reply":"这个问题问得好","cues":["先给结论","补充个人感受"]}' } }],
        },
        finalUrl: 'x',
      }),
    });
    const result = await provider.generateReply(makeInput());
    expect(result).toEqual({
      ok: true,
      output: { quick_reply: '这个问题问得好', cues: ['先给结论', '补充个人感受'] },
      providerRequestId: 'compatible-request-id',
    });
  });

  it('maps a 5000ms timeout to a TIMEOUT error without retry', async () => {
    const provider = new OpenAiCompatibleProvider({
      fetchJsonImpl: async () => {
        throw new ProviderTransportError('TIMEOUT', 'boom');
      },
    });
    const result = await provider.generateReply(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TIMEOUT');
    const audit = provider.getAuditRecord();
    expect(audit?.normalizedError).toBe('TIMEOUT');
  });

  it('rejects invalid output with OUTPUT_INVALID', async () => {
    const provider = new OpenAiCompatibleProvider({
      fetchJsonImpl: async () => ({
        status: 200,
        body: { choices: [{ message: { content: '{"quick_reply":"只有回复，没有提词"}' } }] },
        finalUrl: 'x',
      }),
    });
    const result = await provider.generateReply(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('OUTPUT_INVALID');
  });

  it('audit record never contains the API key', async () => {
    const provider = new OpenAiCompatibleProvider({
      fetchJsonImpl: async () => ({
        status: 200,
        body: { choices: [{ message: { content: '{"quick_reply":"x","cues":["a","b"]}' } }] },
        finalUrl: 'x',
      }),
    });
    await provider.generateReply(makeInput({ apiKey: 'sk-super-secret' }));
    expect(JSON.stringify(provider.getAuditRecord())).not.toContain('sk-super-secret');
  });

  it('shares the same error contract as DeepSeek for identical failures', async () => {
    const makeFailing = (cls: typeof OpenAiCompatibleProvider | typeof DeepSeekProvider) =>
      new cls({
        fetchJsonImpl: async () => {
          throw new ProviderTransportError('TIMEOUT', 'boom');
        },
      });
    const compatible = await makeFailing(OpenAiCompatibleProvider).generateReply(makeInput());
    const deepseek = await makeFailing(DeepSeekProvider).generateReply({
      ...makeInput(),
      adapterType: 'DEEPSEEK',
      baseUrl: 'https://api.deepseek.com',
    });
    expect(compatible).toEqual(deepseek);
    expect(compatible.ok).toBe(false);
  });

  it('returns the same structured output as DeepSeek for identical success input', async () => {
    const successBody = {
      id: 'shared-request-id',
      choices: [{ message: { content: '{"quick_reply":"通用回复","cues":["提词一","提词二"]}' } }],
    };
    const makeSucceeding = (cls: typeof OpenAiCompatibleProvider | typeof DeepSeekProvider) =>
      new cls({
        fetchJsonImpl: async () => ({ status: 200, body: successBody, finalUrl: 'x' }),
      });
    const compatible = await makeSucceeding(OpenAiCompatibleProvider).generateReply(makeInput());
    const deepseek = await makeSucceeding(DeepSeekProvider).generateReply({
      ...makeInput(),
      adapterType: 'DEEPSEEK',
      baseUrl: 'https://api.deepseek.com',
    });
    expect(compatible).toEqual(deepseek);
    expect(compatible).toEqual({
      ok: true,
      output: { quick_reply: '通用回复', cues: ['提词一', '提词二'] },
      providerRequestId: 'shared-request-id',
    });
  });
});
