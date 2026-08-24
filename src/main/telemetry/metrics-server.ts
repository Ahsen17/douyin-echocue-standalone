import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { EchocueMetrics } from './Metrics.js';

export interface MetricsServerHandle {
  start(): void;
  stop(): Promise<void>;
  /** OS-assigned bound address once listening (null before/after). */
  getBoundAddress(): AddressInfo | null;
}

export interface MetricsServerOptions {
  metrics: EchocueMetrics;
  port: number;
  /** Loopback-only is a hard security requirement (ARCH §8); never configurable. */
  host?: string;
  /** Log-only sink; bind failures (e.g. EADDRINUSE) degrade to no HTTP, UI unaffected. */
  log?: (message: string) => void;
}

// Loopback /metrics endpoint (TD-03). Bound to 127.0.0.1 only; a bind failure
// skips HTTP without affecting the in-app monitoring section.
export function createMetricsServer(options: MetricsServerOptions): MetricsServerHandle {
  const host = options.host ?? '127.0.0.1';
  let server: Server | null = null;

  const start = (): void => {
    if (server !== null) return;
    const s = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/metrics') {
        const text = await options.metrics.metricsText();
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(text);
        return;
      }
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    s.on('error', (err) => {
      options.log?.(`metrics server error: ${err instanceof Error ? err.message : String(err)}`);
    });
    s.on('listening', () => {
      options.log?.(`metrics endpoint listening on http://${host}:${options.port}/metrics`);
    });
    s.listen(options.port, host);
    server = s;
  };

  const stop = (): Promise<void> => {
    if (server === null) return Promise.resolve();
    const s = server;
    server = null;
    return new Promise((resolve) => s.close(() => resolve()));
  };

  const getBoundAddress = (): AddressInfo | null => {
    const addr = server?.address();
    return typeof addr === 'object' && addr !== null ? addr : null;
  };

  return { start, stop, getBoundAddress };
}
