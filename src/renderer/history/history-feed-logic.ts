import type { HistorySnapshotV1 } from '@echocue/contracts'

export const SCROLL_NEAR_BOTTOM_PX = 24

// Auto-follow rule: only stick to the newest entry while the user is already
// near the bottom, so reviewing older suggestions is never interrupted.
export function isNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight < SCROLL_NEAR_BOTTOM_PX
}

// Mount-time snapshot adoption: once a pushed snapshot has arrived it always
// wins over the mount request, which reflects main's buffer at an earlier
// moment. Guards the mount/onSnapshot ordering race (M2).
export function adoptInitialSnapshot(
  pushed: HistorySnapshotV1 | null,
  mounted: HistorySnapshotV1,
): HistorySnapshotV1 {
  return pushed ?? mounted
}
