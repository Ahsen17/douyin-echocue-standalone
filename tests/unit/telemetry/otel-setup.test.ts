import { describe, it, expect, vi, beforeEach } from 'vitest';

// T-DIAG-001 / A-13: the OTel exporter must be enable/disable-able and its
// configuration must carry no raw content, keys, or trace ids. The OTel surface
// is the only channel that leaves the process; assert its lifecycle and that no
// sensitive field ever reaches the SDK/exporter config.
const mocks = vi.hoisted(() => {
  const sdkInstances: Array<{
    start: ReturnType<typeof vi.fn>;
    shutdown: ReturnType<typeof vi.fn>;
    metricReader: unknown;
    serviceName: string;
  }> = [];
  return {
    NodeSDKMock: vi.fn((opts: { serviceName?: string; metricReader?: unknown }) => {
      const instance = {
        start: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
        metricReader: opts.metricReader,
        serviceName: opts.serviceName ?? 'echocue',
      };
      sdkInstances.push(instance);
      return instance;
    }),
    sdkInstances,
    OTLPMetricExporterMock: vi.fn((opts: unknown) => ({ opts })),
    PeriodicExportingMetricReaderMock: vi.fn((opts: unknown) => ({ opts })),
  };
});

vi.mock('@opentelemetry/sdk-node', () => ({ NodeSDK: mocks.NodeSDKMock }));
vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  OTLPMetricExporter: mocks.OTLPMetricExporterMock,
}));
vi.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: mocks.PeriodicExportingMetricReaderMock,
}));

// resetModules so the module-level `sdk` variable re-evaluates per test.
async function loadOtel(): Promise<typeof import('../../../src/main/telemetry/OtelSetup.js')> {
  vi.resetModules();
  return import('../../../src/main/telemetry/OtelSetup.js');
}

describe('T-DIAG-001: OTel setup lifecycle and privacy surface', () => {
  beforeEach(() => {
    mocks.sdkInstances.length = 0;
  });

  it('starts a NodeSDK with no metric reader when no endpoint is configured', async () => {
    const { initOtel } = await loadOtel();
    initOtel();
    expect(mocks.sdkInstances).toHaveLength(1);
    expect(mocks.sdkInstances[0].metricReader).toBeUndefined();
    expect(mocks.sdkInstances[0].start).toHaveBeenCalledTimes(1);
    expect(mocks.OTLPMetricExporterMock).not.toHaveBeenCalled();
  });

  it('wires an OTLP metric reader when an endpoint is configured', async () => {
    const { initOtel } = await loadOtel();
    initOtel({ otlpEndpoint: 'https://otel.example.invalid/v1/metrics' });
    expect(mocks.OTLPMetricExporterMock).toHaveBeenCalledWith({
      url: 'https://otel.example.invalid/v1/metrics',
    });
    expect(mocks.PeriodicExportingMetricReaderMock).toHaveBeenCalledTimes(1);
    const reader = mocks.PeriodicExportingMetricReaderMock.mock.results[0].value;
    expect(mocks.sdkInstances[0].metricReader).toBe(reader);
    expect(mocks.sdkInstances[0].serviceName).toBe('echocue');
  });

  it('is idempotent: a second initOtel does not create a second SDK', async () => {
    const { initOtel } = await loadOtel();
    initOtel({ otlpEndpoint: 'https://otel.example.invalid/v1/metrics' });
    initOtel({ otlpEndpoint: 'https://otel.example.invalid/v1/metrics' });
    expect(mocks.sdkInstances).toHaveLength(1);
  });

  it('shutdownOtel shuts down and resets so a later initOtel restarts', async () => {
    const otel = await loadOtel();
    otel.initOtel();
    await otel.shutdownOtel();
    expect(mocks.sdkInstances[0].shutdown).toHaveBeenCalledTimes(1);
    otel.initOtel();
    expect(mocks.sdkInstances).toHaveLength(2);
  });

  it('never forwards sensitive fields into the SDK/exporter config', async () => {
    const { initOtel } = await loadOtel();
    // Extra fields a future caller might attach must not reach the OTel config.
    initOtel({
      otlpEndpoint: 'https://otel.example.invalid/v1/metrics',
      serviceName: 'echocue',
      apiKey: 'sk-test',
      traceId: 'should-never-leak',
      rawComment: '弹幕原文',
    } as never);
    const sdkConfig = mocks.NodeSDKMock.mock.calls[0][0];
    expect(Object.keys(sdkConfig)).toEqual(['serviceName', 'metricReader']);
    expect(sdkConfig.serviceName).toBe('echocue');
    const exporterConfig = mocks.OTLPMetricExporterMock.mock.calls[0][0];
    expect(Object.keys(exporterConfig)).toEqual(['url']);
    expect(JSON.stringify(exporterConfig)).not.toContain('sk-test');
  });
});
