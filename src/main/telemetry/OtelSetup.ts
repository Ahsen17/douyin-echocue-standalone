import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'

let sdk: NodeSDK | null = null

export interface OtelConfig {
  otlpEndpoint?: string
  serviceName?: string
}

export function initOtel(config: OtelConfig = {}): void {
  if (sdk) return

  const readers: PeriodicExportingMetricReader[] = []
  if (config.otlpEndpoint) {
    readers.push(
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: config.otlpEndpoint }),
        exportIntervalMillis: 60_000,
      }),
    )
  }

  sdk = new NodeSDK({
    serviceName: config.serviceName ?? 'echocue',
    metricReader: readers[0],
  })

  sdk.start()
}

export function shutdownOtel(): Promise<void> {
  if (!sdk) return Promise.resolve()
  return sdk.shutdown().finally(() => { sdk = null })
}
