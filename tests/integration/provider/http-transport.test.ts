import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SettingsStore } from '../../../src/main/config/index.js';
import {
  CredentialStore,
  type SafeStorageLike,
} from '../../../src/main/credentials/index.js';
import { ProviderConfigService, ProviderTransportError, fetchJson } from '../../../src/main/provider/index.js';
import type { ChatCompletionsProbe } from '../../../src/main/provider/index.js';

type Handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void;

function startServer(handler: Handler): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

function makeMockStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (b) => b.toString('utf-8').slice(4),
  };
}

describe('provider HTTP transport (integration)', () => {
  let server: Server;
  let port: number;

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('fetches JSON over loopback with allowInsecure (test-only path)', async () => {
    ({ server, port } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }));
    const result = await fetchJson({
      baseUrl: `http://127.0.0.1:${port}`,
      path: '/chat/completions',
      method: 'POST',
      body: { model: 'm', messages: [] },
      timeoutMs: 5000,
      allowInsecure: true,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
  });

  it('rejects non-HTTPS when allowInsecure is not set', async () => {
    ({ server, port } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end();
    }));
    await expect(
      fetchJson({
        baseUrl: `http://127.0.0.1:${port}`,
        path: '/chat/completions',
        body: {},
        timeoutMs: 5000,
      }),
    ).rejects.toBeInstanceOf(ProviderTransportError);
  });

  it('follows a same-origin redirect', async () => {
    ({ server, port } = await startServer((req, res) => {
      if (req.url === '/chat/completions') {
        res.writeHead(302, { location: '/final' });
        res.end();
      } else if (req.url === '/final') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ redirected: true }));
      } else {
        res.writeHead(404);
        res.end();
      }
    }));
    const result = await fetchJson({
      baseUrl: `http://127.0.0.1:${port}`,
      path: '/chat/completions',
      body: {},
      timeoutMs: 5000,
      allowInsecure: true,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ redirected: true });
  });

  it('rejects a cross-host redirect', async () => {
    ({ server, port } = await startServer((_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/evil' });
      res.end();
    }));
    await expect(
      fetchJson({
        baseUrl: `http://127.0.0.1:${port}`,
        path: '/chat/completions',
        body: {},
        timeoutMs: 5000,
        allowInsecure: true,
      }),
    ).rejects.toMatchObject({ kind: 'REDIRECT' });
  });

  it('rejects a redirect loop beyond the cap', async () => {
    ({ server, port } = await startServer((req, res) => {
      res.writeHead(302, { location: '/chat/completions' });
      res.end();
    }));
    await expect(
      fetchJson({
        baseUrl: `http://127.0.0.1:${port}`,
        path: '/chat/completions',
        body: {},
        timeoutMs: 5000,
        maxRedirects: 1,
        allowInsecure: true,
      }),
    ).rejects.toMatchObject({ kind: 'REDIRECT' });
  });

  it('maps a connection refusal to NETWORK', async () => {
    // Port 1 on loopback is virtually always closed.
    await expect(
      fetchJson({
        baseUrl: 'http://127.0.0.1:1',
        path: '/chat/completions',
        body: {},
        timeoutMs: 1000,
        allowInsecure: true,
      }),
    ).rejects.toMatchObject({ kind: 'NETWORK' });
  });

  it('maps a slow server to TIMEOUT', async () => {
    ({ server, port } = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end();
      }, 300);
    }));
    await expect(
      fetchJson({
        baseUrl: `http://127.0.0.1:${port}`,
        path: '/chat/completions',
        body: {},
        timeoutMs: 50,
        allowInsecure: true,
      }),
    ).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('maps an external abort to ABORTED', async () => {
    ({ server, port } = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end();
      }, 300);
    }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    await expect(
      fetchJson({
        baseUrl: `http://127.0.0.1:${port}`,
        path: '/chat/completions',
        body: {},
        timeoutMs: 5000,
        abortSignal: controller.signal,
        allowInsecure: true,
      }),
    ).rejects.toMatchObject({ kind: 'ABORTED' });
  });

  it('rejects an oversized response body', async () => {
    ({ server, port } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: 'x'.repeat(4096) }));
    }));
    await expect(
      fetchJson({
        baseUrl: `http://127.0.0.1:${port}`,
        path: '/chat/completions',
        body: {},
        timeoutMs: 5000,
        maxBodyBytes: 1024,
        allowInsecure: true,
      }),
    ).rejects.toMatchObject({ kind: 'VALIDATION' });
  });

  it('returns a non-JSON body as-is', async () => {
    ({ server, port } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('not json at all');
    }));
    const result = await fetchJson({
      baseUrl: `http://127.0.0.1:${port}`,
      path: '/chat/completions',
      body: {},
      timeoutMs: 5000,
      allowInsecure: true,
    });
    expect(result.status).toBe(200);
    expect(result.body).toBe('not json at all');
  });

  it('ProviderConfigService.testConnection drives the real transport', async () => {
    ({ server, port } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [] }));
    }));
    const testDir = await mkdtemp(join(tmpdir(), 'echocue-provider-int-'));
    try {
      const settings = new SettingsStore(testDir);
      const credentials = new CredentialStore(testDir, makeMockStorage());
      // Schema requires an HTTPS baseUrl; the probe maps it to loopback http for the local server.
      const probe: ChatCompletionsProbe = async (input) => {
        const r = await fetchJson({
          baseUrl: input.baseUrl.replace('https://', 'http://'),
          path: input.path,
          body: input.body,
          apiKey: input.apiKey,
          timeoutMs: input.timeoutMs,
          allowInsecure: true,
        });
        return { status: r.status };
      };
      const service = new ProviderConfigService(settings, credentials, probe);
      await service.updateProviderConfig({
        providerId: 'deepseek-primary',
        displayName: 't',
        adapterType: 'DEEPSEEK',
        baseUrl: `https://127.0.0.1:${port}`,
        modelId: 'm',
        credentialRef: 'safe-storage:deepseek-primary',
      });
      await service.setApiKey('deepseek-primary', 'sk-test');
      expect(await service.testConnection()).toEqual({ status: 'OK' });
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
