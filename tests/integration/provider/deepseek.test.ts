import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { DeepSeekProvider, fetchJson } from '../../../src/main/provider/index.js';
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
    providerId: 'deepseek-primary',
    adapterType: 'DEEPSEEK',
    baseUrl: `http://127.0.0.1:${port}`,
    modelId: 'deepseek-chat',
    messages: [{ role: 'user', content: 'hi' }],
    apiKey: 'sk-secret',
    timeoutMs: 5000,
    freshnessDeadlineMonotonicMs: 1000,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe('DeepSeekProvider integration', () => {
  let server: Server;

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // The loopback test server speaks http; production fetchJson enforces https, so
  // every integration case injects an allowInsecure transport.
  function makeProvider(): DeepSeekProvider {
    return new DeepSeekProvider({
      fetchJsonImpl: (input) => fetchJson({ ...input, allowInsecure: true }),
    });
  }

  function portOf(): number {
    return (server.address() as { port: number }).port;
  }

  it('sends a non-streaming JSON chat/completions request without tools', async () => {
    let receivedBody: unknown;
    ({ server } = await startServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        receivedBody = JSON.parse(data);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '{"quick_reply":"x","cues":["a","b"]}' } }] }));
      });
    }));
    const provider = makeProvider();
    const result = await provider.generateReply(makeInput(portOf()));
    expect(result.ok).toBe(true);
    expect(receivedBody).toMatchObject({
      model: 'deepseek-chat',
      stream: false,
      response_format: { type: 'json_object' },
    });
    expect(JSON.stringify(receivedBody)).not.toContain('tools');
  });

  it('propagates an HTTP 401 as AUTH over the real transport', async () => {
    ({ server } = await startServer((_req, res) => {
      res.writeHead(401);
      res.end();
    }));
    const provider = makeProvider();
    const result = await provider.generateReply(makeInput(portOf()));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUTH');
      expect(result.error.providerStatus).toBe(401);
    }
  });

  it('propagates a server 503 as SERVER over the real transport', async () => {
    ({ server } = await startServer((_req, res) => {
      res.writeHead(503);
      res.end();
    }));
    const provider = makeProvider();
    const result = await provider.generateReply(makeInput(portOf()));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SERVER');
      expect(result.error.providerStatus).toBe(503);
    }
  });

  it('aborts in-flight generation when the abort signal fires', async () => {
    ({ server } = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end();
      }, 500);
    }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const provider = makeProvider();
    const result = await provider.generateReply(
      makeInput(portOf(), { abortSignal: controller.signal }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ABORTED');
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

  it('audit record over the real transport excludes the key', async () => {
    ({ server } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '{"quick_reply":"x","cues":["a","b"]}' } }] }));
    }));
    const provider = makeProvider();
    await provider.generateReply(makeInput(portOf(), { apiKey: 'sk-integration-secret' }));
    const audit = provider.getAuditRecord();
    expect(JSON.stringify(audit)).not.toContain('sk-integration-secret');
  });
});
