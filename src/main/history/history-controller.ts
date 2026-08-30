import type {
  HistoryEntryV1,
  HistorySnapshotV1,
  OverlayDisplayPayloadV1,
  OverlayPreferenceV1,
} from '@echocue/contracts';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { HistoryBuffer } from './history-buffer.js';

/** Minimal history-window surface the controller drives (decoupled from Electron). */
export interface HistoryWindowLike {
  isReady(): boolean;
  send(channel: string, payload: unknown): void;
}

export interface HistoryControllerDeps {
  window: HistoryWindowLike;
  capacity?: number;
  /** Local "HH:mm:ss" of the display wall clock; inject for deterministic tests. */
  formatDisplayedAt?: () => string;
}

export interface HistoryController {
  /** Append one displayed suggestion; drops the oldest once capacity is exceeded. */
  record(payload: OverlayDisplayPayloadV1): void;
  /** Clear the feed (service stop / quit). */
  clear(): void;
  /** Renderer bootstrap: current entries + capacity. */
  getSnapshot(): HistorySnapshotV1;
  applyCapacity(maxEntries: number): void;
  /** Reuse the overlay theme/fontScale so both floating windows stay consistent. */
  applyVisualPrefs(prefs: OverlayPreferenceV1): void;
  destroy(): void;
}

export function defaultDisplayedAt(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

// The renderer is a pure view of main's authoritative buffer: every mutation
// pushes a full HistorySnapshotV1, so there is no incremental-push race against
// the renderer's mount-time snapshot request. trace_id never enters entries.
export function createHistoryController(deps: HistoryControllerDeps): HistoryController {
  const buffer = new HistoryBuffer(deps.capacity ?? 20);
  const formatDisplayedAt = deps.formatDisplayedAt ?? defaultDisplayedAt;

  const pushSnapshot = (): void => {
    if (!deps.window.isReady()) return;
    deps.window.send(IpcChannel.HistorySnapshotChanged, {
      entries: buffer.snapshot(),
      capacity: buffer.capacity,
    });
  };

  return {
    record(payload) {
      const entry: HistoryEntryV1 = {
        displayedAt: formatDisplayedAt(),
        comment: payload.comment,
        suggestion: payload.suggestion,
      };
      buffer.append(entry);
      pushSnapshot();
    },
    clear() {
      buffer.clear();
      pushSnapshot();
    },
    getSnapshot() {
      return { entries: buffer.snapshot(), capacity: buffer.capacity };
    },
    applyCapacity(maxEntries) {
      buffer.setCapacity(maxEntries);
      pushSnapshot();
    },
    applyVisualPrefs(prefs) {
      if (!deps.window.isReady()) return;
      deps.window.send(IpcChannel.HistoryPreferenceChanged, prefs);
    },
    destroy() {
      buffer.clear();
    },
  };
}
