import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SIDECAR_PINS } from '../../src/main/sidecar-pins.js';

function sha256Hex(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// Single-source enforcement: the runtime pins must equal the actual committed
// binaries AND the authoritative assets/README.md bundle manifest, so a binary
// swap that passes install would still be blocked at sidecar start.
describe('sidecar pins (M7-08 runtime binary verification)', () => {
  it('match the actual committed binaries and assets/README.md', () => {
    const readme = readFileSync(join(process.cwd(), 'assets', 'README.md'), 'utf8');
    const expected: Record<string, string> = {
      'assets/qdrant_windows.exe': SIDECAR_PINS.qdrant.sha256,
      'assets/douyinLive_windows.exe': SIDECAR_PINS.douyinLive.sha256,
    };
    for (const [rel, sha] of Object.entries(expected)) {
      expect(sha256Hex(join(process.cwd(), rel)), `${rel} sha mismatch`).toBe(sha);
      expect(readme, `README must pin ${rel}`).toContain(sha);
    }
    expect(SIDECAR_PINS.qdrant.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SIDECAR_PINS.douyinLive.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
