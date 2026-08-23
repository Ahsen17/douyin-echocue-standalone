import { describe, expect, it } from 'vitest';
import { buildReleaseManifest } from '../../scripts/generate-release-manifest.js';

const inputs = {
  appVersion: '0.1.0',
  gitCommit: '0123456789abcdef0123456789abcdef01234567',
  electronVersion: '35.7.5',
  sidecarVersions: { qdrant: 'Qdrant v1.19.0', douyinLive: 'tag=v2.2.0' },
  artifactShas: {
    'installer/Echocue Setup 0.1.0.exe': 'a'.repeat(64),
    'assets/qdrant_windows.exe': 'b'.repeat(64),
    'assets/douyinLive_windows.exe': 'c'.repeat(64),
  },
  licenseCount: 42,
  sbomRef: `dist/compliance/sbom.cdx.json (sha256:${'d'.repeat(64)})`,
  signature: 'unsigned (no code-signing cert; 需发布环境证书补签)',
};

describe('release manifest generation (M7-09 / T-PKG-001)', () => {
  it('fills versions, commit, sidecars, artifact hashes, license, SBOM and signature', () => {
    const { manifest } = buildReleaseManifest(inputs);
    expect(manifest.app).toMatchObject({
      name: 'Echocue',
      version: '0.1.0',
      commitShort: '0123456',
    });
    expect(manifest.electronRuntime).toBe('35.7.5');
    expect(manifest.sidecars).toEqual({
      qdrant: { version: 'Qdrant v1.19.0' },
      douyinLive: { version: 'tag=v2.2.0' },
    });
    expect(manifest.artifacts).toHaveProperty('installer/Echocue Setup 0.1.0.exe');
    expect(manifest.license).toEqual({ scannedPackages: 42 });
    expect(manifest.sbomRef).toContain('sbom.cdx.json');
    expect(manifest.signature).toContain('unsigned');
  });

  it('renders a read-only markdown checklist with no 待填 placeholders', () => {
    const { markdown } = buildReleaseManifest(inputs);
    expect(markdown).toContain('Echocue Windows 安装包清单 v0.1.0 (0123456)');
    expect(markdown).toContain('Qdrant sidecar：Qdrant v1.19.0');
    expect(markdown).toContain('douyinLive sidecar：tag=v2.2.0');
    expect(markdown).toContain('| installer/Echocue Setup 0.1.0.exe |');
    expect(markdown).not.toContain('待填');
  });
});
