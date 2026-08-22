import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  QDRANT_LOOPBACK_HOST,
  QdrantSidecarManager,
  QdrantUnavailableError,
  SidecarStartFailedError,
} from '../../../src/main/qdrant/index.js';
import {
  freePort,
  resolveQdrantBinary,
  resolveQdrantConfigTemplate,
} from '../retrieval/qdrant-test-utils.js';

const binary = resolveQdrantBinary();
const stopped: QdrantSidecarManager[] = [];

afterEach(async () => {
  for (const manager of stopped.splice(0)) {
    await manager.stop();
  }
});

function makeManager(dataDir: string, httpPort: number, grpcPort: number): QdrantSidecarManager {
  const manager = new QdrantSidecarManager({
    binaryPath: binary as string,
    dataDir,
    configTemplatePath: resolveQdrantConfigTemplate(),
    httpPort,
    grpcPort,
    startupTimeoutMs: 20_000,
    expectedVersion: '1.19.0',
  });
  stopped.push(manager);
  return manager;
}

(binary ? describe : describe.skip)('QdrantSidecarManager integration', () => {
  it('starts, reports healthy, and stops cleanly', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'echocue-qdrant-'));
    const manager = makeManager(dataDir, await freePort(), await freePort());
    try {
      const handle = await manager.start();
      expect(handle.pid).toBeGreaterThan(0);
      expect(handle.httpPort).toBeGreaterThan(0);
      expect(await manager.isHealthy()).toBe(true);

      await manager.stop();
      expect(await manager.isHealthy()).toBe(false);
      expect(manager.pid).toBeNull();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('is idempotent across repeated stop calls', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'echocue-qdrant-'));
    const manager = makeManager(dataDir, await freePort(), await freePort());
    try {
      await manager.start();
      await manager.stop();
      await manager.stop();
      expect(await manager.isHealthy()).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('rejects startup when the http port is already occupied', async () => {
    const blocker: HttpServer = createHttpServer((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    await new Promise<void>((resolve) => blocker.listen(0, QDRANT_LOOPBACK_HOST, resolve));
    const address = blocker.address();
    const httpPort = typeof address === 'object' && address !== null ? address.port : 0;
    const dataDir = mkdtempSync(join(tmpdir(), 'echocue-qdrant-'));
    const manager = makeManager(dataDir, httpPort, await freePort());
    try {
      await expect(manager.start()).rejects.toBeInstanceOf(SidecarStartFailedError);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('fails startup with QdrantUnavailableError when health check times out', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'echocue-qdrant-'));
    const manager = new QdrantSidecarManager({
      binaryPath: binary as string,
      dataDir,
      configTemplatePath: resolveQdrantConfigTemplate(),
      httpPort: await freePort(),
      grpcPort: await freePort(),
      startupTimeoutMs: 50,
    });
    stopped.push(manager);
    try {
      await expect(manager.start()).rejects.toBeInstanceOf(QdrantUnavailableError);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('rejects startup on binary sha256 mismatch', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'echocue-qdrant-'));
    const manager = new QdrantSidecarManager({
      binaryPath: binary as string,
      dataDir,
      configTemplatePath: resolveQdrantConfigTemplate(),
      httpPort: await freePort(),
      grpcPort: await freePort(),
      sha256: 'deadbeef',
    });
    stopped.push(manager);
    try {
      await expect(manager.start()).rejects.toBeInstanceOf(SidecarStartFailedError);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('detects an externally killed sidecar as unhealthy', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'echocue-qdrant-'));
    const manager = makeManager(dataDir, await freePort(), await freePort());
    try {
      await manager.start();
      const pid = manager.pid as number;
      process.kill(pid, 'SIGKILL');
      const deadline = Date.now() + 10_000;
      while (await manager.isHealthy()) {
        if (Date.now() > deadline) throw new Error('sidecar still healthy after kill');
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(await manager.isHealthy()).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
