import type { SuggestionDisplaySink } from '../suggestion/index.js';
import type { OverlayWindow } from '../windows/OverlayWindow.js';
import { uuidv7 } from '../util/index.js';

export interface OverlayDisplaySinkDeps {
  overlayWindow: OverlayWindow;
}

// M5-07 port implementation (M6-07): drives the Electron overlay window. The
// meta argument (which carries trace_id) stays in main; only the visible
// payload crosses IPC via a requestId nonce.
export function createOverlayDisplaySink(deps: OverlayDisplaySinkDeps): SuggestionDisplaySink {
  const { overlayWindow } = deps;
  return {
    async show(payload) {
      return overlayWindow.showSuggestion(payload, uuidv7());
    },
    async hide() {
      await overlayWindow.hideSuggestion();
    },
  };
}
