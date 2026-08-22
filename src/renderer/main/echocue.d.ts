import type { ServiceViewState } from '@echocue/contracts'

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
}

declare global {
  interface Window {
    echocue: EchocueWindow
  }
}

export {}
