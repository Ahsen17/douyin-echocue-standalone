import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { DomainErrorV1Schema } from '@echocue/contracts';
import type { DomainErrorV1 } from '@echocue/contracts';
import {
  DOUYIN_LIVE_DEFAULT_STARTUP_TIMEOUT_MS,
  DOUYIN_LIVE_HEALTH_POLL_INTERVAL_MS,
  DOUYIN_LIVE_HOST,
  DOUYIN_LIVE_STDIO_BUFFER_LIMIT,
  DOUYIN_LIVE_WS_PORT,
} from './constants.js';
import type { DouyinLiveSidecarHandle, DouyinLiveSidecarOptions } from './types.js';

export class SidecarStartFailedError extends Error {
  readonly code: DomainErrorV1 = DomainErrorV1Schema.enum.E_SIDECAR_START_FAILED;
  constructor(message: string) {
    super(message);
    this.name = 'SidecarStartFailedError';
  }
}

export class SourceUnavailableError extends Error {
  readonly code: DomainErrorV1 = DomainErrorV1Schema.enum.E_SOURCE_UNAVAILABLE;
  constructor(message: string) {
    super(message);
    this.name = 'SourceUnavailableError';
  }
}

export function renderSpawnArgs(port: number, extraArgs: string[] = []): string[] {
  return ['--port', String(port), ...extraArgs];
}

export function parseVersionTag(output: string): string | null {
  const match = output.match(/tag=v(\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : null;
}

// 二进制在端口被占时会自动改绑到 port+1；通过启动日志确认其实际绑定端口与请求端口一致
export function parseBoundPort(output: string): number | null {
  const match = output.match(/addr=ws:\/\/[^:]+:(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const [major, minor, patch = 0] = version.split('.').map((n) => parseInt(n, 10) || 0);
  return { major, minor, patch };
}

export function gteVersion(a: string, b: string): boolean {
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

async function probeVersion(binaryPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const probe = spawn(binaryPath, ['--version'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const drain = (chunk: string | Buffer) => {
      output += String(chunk);
    };
    probe.stdout?.on('data', drain);
    probe.stderr?.on('data', drain);
    const timer = setTimeout(() => probe.kill('SIGKILL'), 5000);
    probe.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    probe.once('exit', () => {
      clearTimeout(timer);
      resolve(parseVersionTag(output));
    });
  });
}

async function probeTcpPort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

export class DouyinLiveSidecarManager {
  private readonly binaryPath: string;
  private readonly dataDir: string;
  private readonly host: string;
  readonly port: number;
  private readonly startupTimeoutMs: number;
  private readonly expectedVersion?: string;
  private readonly sha256?: string;
  private readonly extraArgs: string[];

  private child: ChildProcess | null = null;
  private outputTail = '';

  constructor(options: DouyinLiveSidecarOptions) {
    this.binaryPath = options.binaryPath;
    this.dataDir = options.dataDir;
    this.host = options.host ?? DOUYIN_LIVE_HOST;
    this.port = options.port ?? DOUYIN_LIVE_WS_PORT;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DOUYIN_LIVE_DEFAULT_STARTUP_TIMEOUT_MS;
    this.expectedVersion = options.expectedVersion;
    this.sha256 = options.sha256;
    this.extraArgs = options.extraArgs ?? [];
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  async isHealthy(): Promise<boolean> {
    if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) {
      return false;
    }
    return probeTcpPort(this.host, this.port);
  }

  async start(): Promise<DouyinLiveSidecarHandle> {
    if (this.child !== null && this.child.exitCode === null) {
      throw new SidecarStartFailedError('douyinLive sidecar is already running');
    }
    this.outputTail = '';

    if (!existsSync(this.binaryPath)) {
      throw new SidecarStartFailedError(`douyinLive binary not found: ${this.binaryPath}`);
    }
    if (this.sha256 !== undefined) {
      const actual = await computeFileSha256(this.binaryPath);
      if (actual !== this.sha256) {
        throw new SidecarStartFailedError('douyinLive binary sha256 mismatch');
      }
    }
    if (this.expectedVersion !== undefined) {
      const actual = await probeVersion(this.binaryPath);
      if (actual === null) {
        throw new SidecarStartFailedError('douyinLive version probe failed');
      }
      if (!gteVersion(actual, this.expectedVersion)) {
        throw new SidecarStartFailedError(
          `douyinLive version ${actual} < expected ${this.expectedVersion}`,
        );
      }
    }

    mkdirSync(this.dataDir, { recursive: true });
    const child = spawn(this.binaryPath, renderSpawnArgs(this.port, this.extraArgs), {
      cwd: this.dataDir,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => this.trackOutput(chunk));
    child.stderr?.on('data', (chunk) => this.trackOutput(chunk));
    this.child = child;

    try {
      const readiness = await waitForReady(
        this.host,
        this.port,
        this.startupTimeoutMs,
        child,
        () => this.outputTail,
      );
      if (readiness === 'exited') {
        throw new SidecarStartFailedError(this.describeStartFailure());
      }
      if (readiness === 'wrong-port') {
        throw new SidecarStartFailedError(
          `douyinLive bound to a different port; expected ${this.port}`,
        );
      }
      if (readiness === 'timeout') {
        throw new SourceUnavailableError(
          `douyinLive ws startup timed out after ${this.startupTimeoutMs}ms`,
        );
      }
      return { pid: child.pid ?? 0, port: this.port };
    } catch (err) {
      await this.stop();
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

  private trackOutput(chunk: string | Buffer): void {
    this.outputTail = (this.outputTail + String(chunk)).slice(-DOUYIN_LIVE_STDIO_BUFFER_LIMIT);
  }

  private describeStartFailure(): string {
    const detail = this.outputTail.trim();
    return detail
      ? `douyinLive exited during startup: ${detail}`
      : 'douyinLive exited during startup';
  }
}

type Readiness = 'ready' | 'exited' | 'wrong-port' | 'timeout';

async function waitForReady(
  host: string,
  requestedPort: number,
  timeoutMs: number,
  child: ChildProcess,
  getOutput: () => string,
): Promise<Readiness> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return 'exited';
    const boundPort = parseBoundPort(getOutput());
    if (boundPort !== null) {
      if (boundPort !== requestedPort) return 'wrong-port';
      if (await probeTcpPort(host, requestedPort)) return 'ready';
    }
    await new Promise((resolve) => setTimeout(resolve, DOUYIN_LIVE_HEALTH_POLL_INTERVAL_MS));
  }
  return 'timeout';
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
