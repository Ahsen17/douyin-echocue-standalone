import type { OverlayDisplayRequestV1, OverlayPreferenceV1 } from '@echocue/contracts'

export interface OverlayEchocueApi {
  overlay: {
    onDisplay(cb: (req: OverlayDisplayRequestV1) => void): () => void
    onHide(cb: () => void): () => void
    onPreference(cb: (prefs: OverlayPreferenceV1) => void): () => void
    ack(requestId: string): Promise<void>
  }
}

// The overlay renderer is a separate process with its own minimal preload; the
// main window's ambient echocue global does not apply here.
export function overlayEchocue(): OverlayEchocueApi {
  return (window as unknown as { echocue: OverlayEchocueApi }).echocue
}
