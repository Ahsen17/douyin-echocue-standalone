import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QDRANT_LOOPBACK_HOST,
  QdrantSidecarManager,
} from '../../../src/main/qdrant/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

export function resolveQdrantBinary(): string | null {
  const fromEnv = process.env.QDRANT_BINARY_PATH;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  const name = process.platform === 'win32' ? 'qdrant_windows.exe' : 'qdrant_linux';
  const candidate = join(REPO_ROOT, 'assets', name);
  return existsSync(candidate) ? candidate : null;
}

export function resolveQdrantConfigTemplate(): string {
  return join(REPO_ROOT, 'resources', 'qdrant-config.yaml');
}

export async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, QDRANT_LOOPBACK_HOST, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('unable to allocate port')));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}

export interface TestQdrant {
  readonly manager: QdrantSidecarManager;
  readonly baseUrl: string;
  readonly dataDir: string;
  stop(): Promise<void>;
}

export async function startTestQdrant(): Promise<TestQdrant> {
  const binary = resolveQdrantBinary();
  if (binary === null) {
    throw new Error('Qdrant binary not found; set QDRANT_BINARY_PATH or check assets/');
  }
  const dataDir = mkdtempSync(join(tmpdir(), 'echocue-qdrant-'));
  const httpPort = await freePort();
  const grpcPort = await freePort();
  const manager = new QdrantSidecarManager({
    binaryPath: binary,
    dataDir,
    configTemplatePath: resolveQdrantConfigTemplate(),
    httpPort,
    grpcPort,
    startupTimeoutMs: 20_000,
    expectedVersion: '1.19.0',
  });
  await manager.start();
  return {
    manager,
    baseUrl: `http://${QDRANT_LOOPBACK_HOST}:${httpPort}`,
    dataDir,
    stop: async () => {
      await manager.stop();
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
