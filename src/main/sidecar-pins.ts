// Pinned sidecar versions + SHA-256 for the bundled binaries, one entry per
// platform (resolveAssetBinary picks the linux binary on non-Windows). Must stay
// in sync with assets/README.md (the authoritative bundle manifest);
// tests/unit/sidecar-pins.test.ts enforces both against the actual committed
// binaries. The sidecar managers re-verify these at every start and block with
// E_SIDECAR_START_FAILED on mismatch, so a binary swapped after install is never
// launched.
export const SIDECAR_PINS = {
  qdrant: {
    version: '1.19.0',
    sha256: {
      linux: 'f3aa04dd54b303feca241878521e563a2e09ead71e14cbd6caef85e227498d50',
      win32: '369c562eae3d89333a13abfdb522fa209e3f587c1217a1059d817e80814ea9d4',
    },
  },
  douyinLive: {
    version: '2.2.0',
    sha256: {
      linux: '0dd4a90442566fefc4e7b57f94faca68a16e07b9a2eef356e2dea38f31c50320',
      win32: '7738538a9dba51f07b1c9433560db6b6645c0fcec47423a7011c0d63999f463b',
    },
  },
} as const;

// Match resolveAssetBinary's platform selection: Windows uses *_windows.exe,
// everything else uses *_linux.
export function sidecarSha256(
  kind: 'qdrant' | 'douyinLive',
  platform: NodeJS.Platform = process.platform,
): string {
  const key = platform === 'win32' ? 'win32' : 'linux';
  return SIDECAR_PINS[kind].sha256[key];
}
