import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { DomainErrorV1Schema } from '@echocue/contracts';
import type { DomainErrorV1 } from '@echocue/contracts';
import { QDRANT_LOOPBACK_HOST, QDRANT_HTTP_PORT, QDRANT_GRPC_PORT } from './constants.js';
import type { QdrantSidecarHandle, QdrantSidecarOptions } from './types.js';

export const QDRANT_READY_PATH = '/readyz';

const DEFAULT_CONFIG_TEMPLATE = [
  'service:',
  `  host: ${QDRANT_LOOPBACK_HOST}`,
  '  http_port: __HTTP_PORT__',
  '  grpc_port: __GRPC_PORT__',
  'storage:',
  "  storage_path: '__STORAGE_PATH__'",
  '',
].join('\n');

const HEALTH_POLL_INTERVAL_MS = 200;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const STDERR_BUFFER_LIMIT = 4096;

export class SidecarStartFailedError extends Error {
  readonly code: DomainErrorV1 = DomainErrorV1Schema.enum.E_SIDECAR_START_FAILED;
  constructor(message: string) {
    super(message);
    this.name = 'SidecarStartFailedError';
  }
}

export class QdrantUnavailableError extends Error {
  readonly code: DomainErrorV1 = DomainErrorV1Schema.enum.E_QDRANT_UNAVAILABLE;
  constructor(message: string) {
    super(message);
    this.name = 'QdrantUnavailableError';
  }
}

export interface RenderConfigParams {
  httpPort: number;
  grpcPort: number;
  storagePath: string;
  template?: string;
}

export function renderQdrantConfig(params: RenderConfigParams): string {
  const template = params.template ?? DEFAULT_CONFIG_TEMPLATE;
  const storagePath = params.storagePath.replaceAll("'", "''");
  return template
    .replaceAll('__HTTP_PORT__', String(params.httpPort))
    .replaceAll('__GRPC_PORT__', String(params.grpcPort))
    .replaceAll('__STORAGE_PATH__', storagePath);
}

export function qdrantReadyUrl(host: string, port: number): string {
  return `http://${host}:${port}${QDRANT_READY_PATH}`;
}

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const [major, minor, patch = 0] = version.split('.').map((n) => parseInt(n, 10) || 0);
  return { major, minor, patch };
}

function gteVersion(a: string, b: string): boolean {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (va[key] !== vb[key]) return va[key] > vb[key];
  }
  return true;
}

async function computeFileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

export class QdrantSidecarManager {
  private readonly binaryPath: string;
  private readonly dataDir: string;
  private readonly configTemplatePath?: string;
  private readonly host: string;
  readonly httpPort: number;
  private readonly grpcPort: number;
  private readonly startupTimeoutMs: number;
  private readonly expectedVersion?: string;
  private readonly sha256?: string;

  private child: ChildProcess | null = null;
  private stderrTail = '';

  constructor(options: QdrantSidecarOptions) {
    this.binaryPath = options.binaryPath;
    this.dataDir = options.dataDir;
    this.configTemplatePath = options.configTemplatePath;
    this.host = options.host ?? QDRANT_LOOPBACK_HOST;
    this.httpPort = options.httpPort ?? QDRANT_HTTP_PORT;
    this.grpcPort = options.grpcPort ?? QDRANT_GRPC_PORT;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.expectedVersion = options.expectedVersion;
    this.sha256 = options.sha256;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  async isHealthy(): Promise<boolean> {
    if (!this.child || this.child.exitCode !== null) return false;
    return fetchReady(this.host, this.httpPort);
  }

  async start(): Promise<QdrantSidecarHandle> {
    if (this.child !== null && this.child.exitCode === null) {
      throw new SidecarStartFailedError('qdrant sidecar is already running');
    }
    this.stderrTail = '';

    if (!existsSync(this.binaryPath)) {
      throw new SidecarStartFailedError(`qdrant binary not found: ${this.binaryPath}`);
    }
    if (this.sha256 !== undefined) {
      const actual = await computeFileSha256(this.binaryPath);
      if (actual !== this.sha256) {
        throw new SidecarStartFailedError('qdrant binary sha256 mismatch');
      }
    }

    mkdirSync(this.dataDir, { recursive: true });
    const configPath = join(this.dataDir, 'qdrant-config.yaml');
    const template = this.configTemplatePath
      ? readFileSync(this.configTemplatePath, 'utf8')
      : undefined;
    writeFileSync(configPath, renderQdrantConfig({
      httpPort: this.httpPort,
      grpcPort: this.grpcPort,
      storagePath: join(this.dataDir, 'storage'),
      template,
    }));

    const child = spawn(this.binaryPath, ['--config-path', configPath], {
      cwd: this.dataDir,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + String(chunk)).slice(-STDERR_BUFFER_LIMIT);
    });
    this.child = child;

    try {
      const ready = await waitForReady(this.host, this.httpPort, this.startupTimeoutMs, child);
      if (!ready) {
        if (child.exitCode !== null) {
          throw new SidecarStartFailedError(this.describeStartFailure());
        }
        throw new QdrantUnavailableError(`qdrant health check timed out after ${this.startupTimeoutMs}ms`);
      }
      if (this.expectedVersion !== undefined) {
        const version = await fetchVersion(this.host, this.httpPort);
        if (version === null) {
          void this.stop();
          throw new SidecarStartFailedError('qdrant version endpoint unreachable');
        }
        if (!gteVersion(version, this.expectedVersion)) {
          void this.stop();
          throw new SidecarStartFailedError(`qdrant version ${version} < expected ${this.expectedVersion}`);
        }
      }
      return { pid: child.pid ?? 0, httpPort: this.httpPort };
    } catch (err) {
      void this.stop();
      throw err;
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const pid = child.pid;
    if (pid === undefined) return;
    const exited = once(child, 'exit').catch(() => undefined);
    if (process.platform === 'win32') {
      await killTreeWindows(pid);
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
    if (child.exitCode === null && child.signalCode === null) await exited;
  }

  private describeStartFailure(): string {
    const detail = this.stderrTail.trim();
    return detail
      ? `qdrant exited during startup: ${detail}`
      : 'qdrant exited during startup';
  }
}

async function waitForReady(
  host: string,
  port: number,
  timeoutMs: number,
  child: ChildProcess,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    if (await fetchReady(host, port)) return true;
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

async function fetchReady(host: string, port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}${QDRANT_READY_PATH}`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchVersion(host: string, port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://${host}:${port}/`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  }
}

function killTreeWindows(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('exit', () => resolve());
    killer.once('error', () => resolve());
  });
}
