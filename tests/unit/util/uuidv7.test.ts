import { describe, it, expect } from 'vitest';
import { uuidv7 } from '../../../src/main/util/uuidv7.js';

// Mirrors the uuidV7 pattern from the shared contract; the contracts package
// keeps the regex as a non-exported constant, so tests assert the same shape.
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function embeddedTimestamp(id: string): number {
  return Number(BigInt(`0x${id.slice(0, 8)}${id.slice(9, 13)}`));
}

describe('uuidv7', () => {
  it('matches the contract UUIDv7 format', () => {
    for (let i = 0; i < 100; i++) {
      expect(uuidv7()).toMatch(UUID_V7);
    }
  });

  it('pins the version nibble to 7 and the variant to 10xx', () => {
    for (let i = 0; i < 100; i++) {
      const id = uuidv7();
      expect(id[14]).toBe('7');
      expect(['8', '9', 'a', 'b']).toContain(id[19]);
    }
  });

  it('embeds the millisecond timestamp in the first 48 bits', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    const ts = embeddedTimestamp(id);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('honors an explicit timestamp argument', () => {
    const id = uuidv7(1_700_000_000_000);
    expect(embeddedTimestamp(id)).toBe(1_700_000_000_000);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });
});
