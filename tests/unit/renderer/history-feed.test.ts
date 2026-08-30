import { describe, expect, it } from 'vitest';
import {
  adoptInitialSnapshot,
  isNearBottom,
  SCROLL_NEAR_BOTTOM_PX,
} from '../../../src/renderer/history/history-feed-logic.js';
import type { HistorySnapshotV1 } from '@echocue/contracts';

const MOUNTED: HistorySnapshotV1 = { entries: [], capacity: 20 };
const PUSHED: HistorySnapshotV1 = {
  entries: [
    {
      displayedAt: '20:00:00',
      comment: { text: '示例弹幕' },
      suggestion: { quickReply: '示例回复', cues: ['一', '二'], source: 'llm' },
    },
  ],
  capacity: 20,
};

describe('history feed logic (history-window)', () => {
  it('isNearBottom is true only within the near-bottom band', () => {
    // 400 - 0 - 400 = 0 < 24 → near bottom
    expect(isNearBottom(400, 0, 400)).toBe(true);
    // 400 - 390 - 10 = 0 < 24 → near bottom
    expect(isNearBottom(400, 390, 10)).toBe(true);
    // 400 - 200 - 100 = 100 >= 24 → scrolled up
    expect(isNearBottom(400, 200, 100)).toBe(false);
    // exactly at the threshold boundary
    expect(isNearBottom(400, 400 - 10 - SCROLL_NEAR_BOTTOM_PX, 10)).toBe(false);
  });

  it('adoptInitialSnapshot prefers a pushed snapshot over the mount response', () => {
    expect(adoptInitialSnapshot(PUSHED, MOUNTED)).toBe(PUSHED);
  });

  it('adoptInitialSnapshot falls back to the mount response when no push arrived', () => {
    expect(adoptInitialSnapshot(null, MOUNTED)).toBe(MOUNTED);
  });
});
