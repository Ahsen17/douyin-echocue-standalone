import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DouyinLiveSidecarManager,
  SidecarStartFailedError,
} from '../../../src/main/douyin/index.js';
import { freePort } from '../retrieval/qdrant-test-utils.js';
import { removeTestDir, resolveDouyinLiveBinary } from './douyin-test-utils.js';

const binary = resolveDouyinLiveBinary();
const stopped: DouyinLiveSidecarManager[] = [];

afterEach(async () => {
  for (const manager of stopped.splice(0)) {
    await manager.stop();
  }
});

function makeManager(dataDir: string, port: number): DouyinLiveSidecarManager {
  const manager = new DouyinLiveSidecarManager({
    binaryPath: binary as string,
    dataDir,
    port,
    startupTimeoutMs: 20_000,
    expectedVersion: '2.2.0',
  });
  stopped.push(manager);
  return manager;
}

(binary ? describe : describe.skip)('DouyinLiveSidecarManager integration', () => {
  it('starts, reports healthy, and stops cleanly', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'echocue-douyin-'));
    const manager = makeManager(dataDir, await freePort());
    try {
      const handle = await manager.start();
      expect(handle.pid).toBeGreaterThan(0);
      expect(handle.port).toBeGreaterThan(0);
      expect(await manager.isHealthy()).toBe(true);

      await manager.stop();
      expect(await manager.isHealthy()).toBe(false);
      expect(manager.pid).toBeNull();
    } finally {
      removeTestDir(dataDir);
    }
  });

  it('is idempotent across repeated stop calls', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'echocue-douyin-'));
    const manager = makeManager(dataDir, await freePort());
    try {
      await manager.start();
      await manager.stop();
      await manager.stop();
      expect(await manager.isHealthy()).toBe(false);
    } finally {
      removeTestDir(dataDir);
    }
  });

  it('rejects startup when the ws port is already occupied', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const address = blocker.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const dataDir = mkdtempSync(join(tmpdir(), 'echocue-douyin-'));
    const manager = makeManager(dataDir, port);
    try {
      await expect(manager.start()).rejects.toBeInstanceOf(SidecarStartFailedError);
      expect(manager.pid).toBeNull();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
      removeTestDir(dataDir);
    }
  });

  it('rejects startup on binary sha256 mismatch', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'echocue-douyin-'));
    const manager = new DouyinLiveSidecarManager({
      binaryPath: binary as string,
      dataDir,
      port: await freePort(),
      startupTimeoutMs: 20_000,
      sha256: 'deadbeef',
    });
    stopped.push(manager);
    try {
      await expect(manager.start()).rejects.toBeInstanceOf(SidecarStartFailedError);
    } finally {
      removeTestDir(dataDir);
    }
  });

  it('rejects startup when the pinned version is too old', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'echocue-douyin-'));
    const manager = new DouyinLiveSidecarManager({
      binaryPath: binary as string,
      dataDir,
      port: await freePort(),
      startupTimeoutMs: 20_000,
      expectedVersion: '99.0.0',
    });
    stopped.push(manager);
    try {
      await expect(manager.start()).rejects.toBeInstanceOf(SidecarStartFailedError);
    } finally {
      removeTestDir(dataDir);
    }
  });

  it('detects an externally killed sidecar as unhealthy', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'echocue-douyin-'));
    const manager = makeManager(dataDir, await freePort());
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
      removeTestDir(dataDir);
    }
  });
});
