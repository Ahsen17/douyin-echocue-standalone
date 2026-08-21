interface EchocueWindow {
  window: {
    close: () => void
    minimize: () => void
    maximize: () => void
    onMaximizeChange: (cb: (isMax: boolean) => void) => void
  }
}

declare global {
  interface Window {
    echocue: EchocueWindow
  }
}

export {}
