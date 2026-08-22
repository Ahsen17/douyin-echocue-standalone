import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DouyinLiveSidecarManager } from '../../../src/main/douyin/index.js';
import { freePort } from '../retrieval/qdrant-test-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

export function resolveDouyinLiveBinary(): string | null {
  const fromEnv = process.env.DOUYINLIVE_BINARY_PATH;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  const name = process.platform === 'win32' ? 'douyinLive_windows.exe' : 'douyinLive_linux';
  const candidate = join(REPO_ROOT, 'assets', name);
  return existsSync(candidate) ? candidate : null;
}

export interface TestDouyinLive {
  readonly manager: DouyinLiveSidecarManager;
  readonly port: number;
  readonly dataDir: string;
  stop(): Promise<void>;
}

export async function startTestDouyinLive(): Promise<TestDouyinLive> {
  const binary = resolveDouyinLiveBinary();
  if (binary === null) {
    throw new Error('douyinLive binary not found; set DOUYINLIVE_BINARY_PATH or check assets/');
  }
  const dataDir = mkdtempSync(join(tmpdir(), 'echocue-douyin-'));
  const port = await freePort();
  const manager = new DouyinLiveSidecarManager({
    binaryPath: binary,
    dataDir,
    port,
    startupTimeoutMs: 20_000,
    expectedVersion: '2.2.0',
  });
  await manager.start();
  return {
    manager,
    port,
    dataDir,
    stop: async () => {
      await manager.stop();
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
