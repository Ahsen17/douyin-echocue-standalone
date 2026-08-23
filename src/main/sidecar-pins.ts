// Pinned sidecar versions + SHA-256 for the bundled binaries. Must stay in sync
// with assets/README.md (the authoritative bundle manifest); tests/unit/
// sidecar-pins.test.ts enforces both against the actual committed binaries.
// The sidecar managers re-verify these at every start and block with
// E_SIDECAR_START_FAILED on mismatch, so a binary swapped after install is never
// launched.
export const SIDECAR_PINS = {
  qdrant: {
    version: '1.19.0',
    sha256: '369c562eae3d89333a13abfdb522fa209e3f587c1217a1059d817e80814ea9d4',
  },
  douyinLive: {
    version: '2.2.0',
    sha256: '7738538a9dba51f07b1c9433560db6b6645c0fcec47423a7011c0d63999f463b',
  },
} as const;
