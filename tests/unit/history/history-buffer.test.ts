import { describe, expect, it } from 'vitest';
import { HistoryBuffer } from '../../../src/main/history/history-buffer.js';
import type { HistoryEntryV1 } from '@echocue/contracts';

function entry(id: number): HistoryEntryV1 {
  return {
    displayedAt: `${id}`,
    comment: { text: `弹幕${id}` },
    suggestion: { quickReply: `回复${id}`, cues: ['一', '二'], source: 'llm' },
  };
}

describe('HistoryBuffer', () => {
  it('keeps entries in chronological append order', () => {
    const buffer = new HistoryBuffer(3);
    buffer.append(entry(1));
    buffer.append(entry(2));
    buffer.append(entry(3));
    expect(buffer.snapshot().map((e) => e.displayedAt)).toEqual(['1', '2', '3']);
  });

  it('drops the oldest entry once the capacity is exceeded', () => {
    const buffer = new HistoryBuffer(2);
    buffer.append(entry(1));
    buffer.append(entry(2));
    buffer.append(entry(3));
    expect(buffer.snapshot().map((e) => e.displayedAt)).toEqual(['2', '3']);
  });

  it('snapshot returns a copy, not the internal array', () => {
    const buffer = new HistoryBuffer(2);
    buffer.append(entry(1));
    const snap = buffer.snapshot();
    snap.push(entry(2));
    expect(buffer.snapshot()).toHaveLength(1);
  });

  it('setCapacity shrinks and prunes the oldest entries', () => {
    const buffer = new HistoryBuffer(5);
    buffer.append(entry(1));
    buffer.append(entry(2));
    buffer.append(entry(3));
    buffer.setCapacity(2);
    expect(buffer.capacity).toBe(2);
    expect(buffer.snapshot().map((e) => e.displayedAt)).toEqual(['2', '3']);
  });

  it('setCapacity can grow without losing entries', () => {
    const buffer = new HistoryBuffer(2);
    buffer.append(entry(1));
    buffer.setCapacity(10);
    expect(buffer.snapshot()).toHaveLength(1);
    expect(buffer.capacity).toBe(10);
  });

  it('clear empties the feed', () => {
    const buffer = new HistoryBuffer(2);
    buffer.append(entry(1));
    buffer.clear();
    expect(buffer.snapshot()).toEqual([]);
  });
});
