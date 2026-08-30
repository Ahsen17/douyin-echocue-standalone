import type { HistorySnapshotV1, OverlayPreferenceV1 } from '@echocue/contracts'

export interface HistoryEchocueApi {
  history: {
    getSnapshot(): Promise<HistorySnapshotV1>
    onSnapshot(cb: (snap: HistorySnapshotV1) => void): () => void
    onPreference(cb: (prefs: OverlayPreferenceV1) => void): () => void
  }
}

// The history renderer is a separate process with its own minimal preload; the
// main window's ambient echocue global does not apply here.
export function historyEchocue(): HistoryEchocueApi {
  return (window as unknown as { echocue: HistoryEchocueApi }).echocue
}
