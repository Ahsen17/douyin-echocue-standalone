import { describe, expect, it } from 'vitest';
import {
  QDRANT_GRPC_PORT,
  QDRANT_HTTP_PORT,
  QDRANT_LOOPBACK_HOST,
  QDRANT_READY_PATH,
  QdrantUnavailableError,
  SidecarStartFailedError,
  qdrantReadyUrl,
  renderQdrantConfig,
} from '../../../src/main/qdrant/index.js';

describe('Qdrant sidecar constants', () => {
  it('locks loopback host and default ports', () => {
    expect(QDRANT_LOOPBACK_HOST).toBe('127.0.0.1');
    expect(QDRANT_HTTP_PORT).toBe(6333);
    expect(QDRANT_GRPC_PORT).toBe(6334);
    expect(QDRANT_READY_PATH).toBe('/readyz');
  });

  it('builds the ready-check URL on loopback', () => {
    expect(qdrantReadyUrl('127.0.0.1', 6333)).toBe('http://127.0.0.1:6333/readyz');
  });
});

describe('Qdrant sidecar typed errors', () => {
  it('maps to canonical domain error codes', () => {
    expect(new SidecarStartFailedError('x').code).toBe('E_SIDECAR_START_FAILED');
    expect(new QdrantUnavailableError('x').code).toBe('E_QDRANT_UNAVAILABLE');
  });
});

describe('renderQdrantConfig', () => {
  it('injects ports and absolute storage path while keeping host loopback', () => {
    const rendered = renderQdrantConfig({
      httpPort: 17001,
      grpcPort: 17002,
      storagePath: '/tmp/echocue-qdrant/storage',
    });
    expect(rendered).toContain('host: 127.0.0.1');
    expect(rendered).toContain('http_port: 17001');
    expect(rendered).toContain('grpc_port: 17002');
    expect(rendered).toContain("storage_path: '/tmp/echocue-qdrant/storage'");
    expect(rendered).not.toContain('__HTTP_PORT__');
    expect(rendered).not.toContain('__STORAGE_PATH__');
  });

  it('preserves placeholders in a custom template', () => {
    const template = 'host: __HOST__\nport: __HTTP_PORT__\nstorage: __STORAGE_PATH__';
    const rendered = renderQdrantConfig({
      httpPort: 9,
      grpcPort: 9,
      storagePath: 's',
      template,
    });
    expect(rendered).toContain('port: 9');
    expect(rendered).toContain('__HOST__'); // untouched placeholder survives
  });

  it('escapes single quotes for the YAML single-quoted storage path', () => {
    const rendered = renderQdrantConfig({
      httpPort: 6333,
      grpcPort: 6334,
      storagePath: "C:/Users/O'Brien/Echocue/storage",
    });
    expect(rendered).toContain("storage_path: 'C:/Users/O''Brien/Echocue/storage'");
  });
});
