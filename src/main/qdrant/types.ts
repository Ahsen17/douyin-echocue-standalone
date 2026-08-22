export interface QdrantSidecarOptions {
  binaryPath: string;
  dataDir: string;
  configTemplatePath?: string;
  host?: string;
  httpPort?: number;
  grpcPort?: number;
  startupTimeoutMs?: number;
  expectedVersion?: string;
  sha256?: string;
}

export interface QdrantSidecarHandle {
  readonly pid: number;
  readonly httpPort: number;
}
