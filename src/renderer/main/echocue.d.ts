import type { ConnectionTestResultV1, ServiceViewState } from '@echocue/contracts'

interface EchocueWindow {
  window: {
    close: () => void
    minimize: () => void
    maximize: () => void
    onMaximizeChange: (cb: (isMax: boolean) => void) => void
  }
  service: {
    subscribe: (cb: (state: ServiceViewState) => void) => () => void
    start: () => Promise<ServiceViewState>
    stop: () => Promise<ServiceViewState>
  }
  provider: {
    setApiKey: (providerId: string, apiKey: string) => Promise<{ apiKeyConfigured: boolean }>
    clearApiKey: (providerId: string) => Promise<{ apiKeyConfigured: boolean }>
    testConnection: () => Promise<ConnectionTestResultV1>
  }
}

declare global {
  interface Window {
    echocue: EchocueWindow
  }
}

export {}
