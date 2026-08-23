import { describe, expect, it } from 'vitest';
import { formatOverlaySentTime } from '../../../src/main/suggestion/format-overlay-sent-time.js';

describe('formatOverlaySentTime', () => {
  it('treats a seconds createTime as Unix seconds and formats as local HH:mm:ss', () => {
    const expected = new Date(1724304000 * 1000).toLocaleTimeString('zh-CN', { hour12: false });
    expect(formatOverlaySentTime('1724304000', undefined)).toBe(expected);
  });

  it('treats a millis createTime as millis and yields the same local time as seconds', () => {
    const seconds = formatOverlaySentTime('1724304000', undefined);
    const millis = formatOverlaySentTime(String(1724304000 * 1000), undefined);
    expect(millis).toBe(seconds);
    expect(millis).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('falls back to the local receipt time when createTime is missing', () => {
    expect(formatOverlaySentTime(undefined, '2026-08-22T00:00:00.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('prefers createTime over the receipt fallback', () => {
    const viaCreateTime = formatOverlaySentTime('1724304000', '2026-08-22T00:00:00.000Z');
    const viaReceipt = formatOverlaySentTime(undefined, '2026-08-22T00:00:00.000Z');
    expect(viaCreateTime).not.toBe(viaReceipt);
  });

  it('returns undefined when createTime is empty but receipt is present', () => {
    expect(formatOverlaySentTime('', '2026-08-22T00:00:00.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('returns undefined when neither source parses', () => {
    expect(formatOverlaySentTime(undefined, undefined)).toBeUndefined();
    expect(formatOverlaySentTime('not-a-number', 'not-a-date')).toBeUndefined();
    expect(formatOverlaySentTime('0', '')).toBeUndefined();
  });
});
