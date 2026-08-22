export interface DouyinLiveSidecarOptions {
  binaryPath: string;
  dataDir: string;
  host?: string;
  port?: number;
  startupTimeoutMs?: number;
  expectedVersion?: string;
  sha256?: string;
  extraArgs?: string[];
}

export interface DouyinLiveSidecarHandle {
  readonly pid: number;
  readonly port: number;
}
