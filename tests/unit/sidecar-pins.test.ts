import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SIDECAR_PINS, sidecarSha256 } from '../../src/main/sidecar-pins.js';

function sha256Hex(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const BINARIES: Record<string, { linux: string; win32: string }> = {
  qdrant: { linux: 'assets/qdrant_linux', win32: 'assets/qdrant_windows.exe' },
  douyinLive: { linux: 'assets/douyinLive_linux', win32: 'assets/douyinLive_windows.exe' },
};

// Single-source enforcement: the runtime pins must equal the actual committed
// binaries on every platform AND the authoritative assets/README.md bundle
// manifest, so a binary swap that passes install would still be blocked at
// sidecar start.
describe('sidecar pins (M7-08 runtime binary verification)', () => {
  it('match the actual committed binaries and assets/README.md on each platform', () => {
    const readme = readFileSync(join(process.cwd(), 'assets', 'README.md'), 'utf8');
    for (const [kind, rels] of Object.entries(BINARIES)) {
      const pins = SIDECAR_PINS[kind as keyof typeof SIDECAR_PINS];
      for (const platform of ['linux', 'win32'] as const) {
        const sha = pins.sha256[platform];
        expect(sha, `${kind} ${platform} pin must be 64 hex`).toMatch(/^[0-9a-f]{64}$/);
        expect(
          sha256Hex(join(process.cwd(), rels[platform])),
          `${rels[platform]} sha mismatch`,
        ).toBe(sha);
        expect(readme, `README must pin ${rels[platform]}`).toContain(sha);
      }
      expect(pins.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('selects the sha for the running platform like resolveAssetBinary', () => {
    expect(sidecarSha256('qdrant', 'win32')).toBe(SIDECAR_PINS.qdrant.sha256.win32);
    expect(sidecarSha256('douyinLive', 'linux')).toBe(SIDECAR_PINS.douyinLive.sha256.linux);
    // Any non-win32 platform resolves to the linux binary (resolveAssetBinary rule).
    expect(sidecarSha256('qdrant', 'darwin')).toBe(SIDECAR_PINS.qdrant.sha256.linux);
  });
});
