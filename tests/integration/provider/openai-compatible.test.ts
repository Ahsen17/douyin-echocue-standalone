import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { OpenAiCompatibleProvider, fetchJson } from '../../../src/main/provider/index.js';
import type { ProviderGenerateInput } from '../../../src/main/provider/index.js';

type Handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void;

function startServer(handler: Handler): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

function makeInput(port: number, overrides: Partial<ProviderGenerateInput> = {}): ProviderGenerateInput {
  return {
    sessionId: 's',
    traceId: 't',
    windowVersion: 1,
    providerId: 'compatible-backup',
    adapterType: 'OPENAI_COMPATIBLE',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    modelId: 'compatible-model',
    messages: [{ role: 'user', content: 'hi' }],
    apiKey: 'sk-secret',
    timeoutMs: 5000,
    freshnessDeadlineMonotonicMs: 1000,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe('OpenAiCompatibleProvider integration', () => {
  let server: Server;

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function makeProvider(): OpenAiCompatibleProvider {
    return new OpenAiCompatibleProvider({
      fetchJsonImpl: (input) => fetchJson({ ...input, allowInsecure: true }),
    });
  }

  function portOf(): number {
    return (server.address() as { port: number }).port;
  }

  it('hits the /v1/chat/completions path and sends the MVP request without tools', async () => {
    let seenUrl = '';
    let seenBody: unknown;
    ({ server } = await startServer((req, res) => {
      seenUrl = req.url ?? '';
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        seenBody = JSON.parse(data);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '{"quick_reply":"x","cues":["a","b"]}' } }] }));
      });
    }));
    const provider = makeProvider();
    const result = await provider.generateReply(makeInput(portOf()));
    expect(seenUrl).toBe('/v1/chat/completions');
    expect(seenBody).toMatchObject({
      model: 'compatible-model',
      stream: false,
      response_format: { type: 'json_object' },
    });
    expect(JSON.stringify(seenBody)).not.toContain('tools');
    expect(JSON.stringify(seenBody)).not.toContain('tool_choice');
    expect(result.ok).toBe(true);
  });

  it('maps an HTTP 429 to RATE_LIMIT over the real transport', async () => {
    ({ server } = await startServer((_req, res) => {
      res.writeHead(429);
      res.end();
    }));
    const provider = makeProvider();
    const result = await provider.generateReply(makeInput(portOf()));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RATE_LIMIT');
      expect(result.error.providerStatus).toBe(429);
    }
  });

  it('times out a slow server as TIMEOUT over the real transport', async () => {
    ({ server } = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end();
      }, 400);
    }));
    const provider = makeProvider();
    const result = await provider.generateReply(makeInput(portOf(), { timeoutMs: 50 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TIMEOUT');
  });

  it('rejects invalid output over the real transport', async () => {
    ({ server } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '{"quick_reply":"only reply"}' } }] }));
    }));
    const provider = makeProvider();
    const result = await provider.generateReply(makeInput(portOf()));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('OUTPUT_INVALID');
  });
});
