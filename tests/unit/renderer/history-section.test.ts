import { describe, expect, it } from 'vitest';
import {
  HISTORY_DEFAULT_ENTRIES,
  HISTORY_MAX_ENTRIES,
  HISTORY_MIN_ENTRIES,
  validateMaxEntries,
} from '../../../src/renderer/main/history/history-section-logic.js';

describe('history section logic (history-window)', () => {
  it('exposes the default of 20 with a 1..120 bound', () => {
    expect(HISTORY_DEFAULT_ENTRIES).toBe(20);
    expect(HISTORY_MIN_ENTRIES).toBe(1);
    expect(HISTORY_MAX_ENTRIES).toBe(120);
  });

  it('accepts values inside the bound', () => {
    expect(validateMaxEntries(1)).toBeNull();
    expect(validateMaxEntries(20)).toBeNull();
    expect(validateMaxEntries(120)).toBeNull();
  });

  it('rejects values outside the bound', () => {
    expect(validateMaxEntries(0)).toMatch(/1–120/);
    expect(validateMaxEntries(121)).toMatch(/1–120/);
  });

  it('rejects non-integers and NaN', () => {
    expect(validateMaxEntries(20.5)).toMatch(/1–120/);
    expect(validateMaxEntries(Number.NaN)).toMatch(/1–120/);
  });
});
