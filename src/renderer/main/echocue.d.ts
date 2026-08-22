import type { EchocueApi } from '../../preload/main-preload'

declare global {
  interface Window {
    echocue: EchocueApi
  }
}

export {}
