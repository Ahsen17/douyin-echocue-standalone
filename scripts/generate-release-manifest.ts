// M7-09: build the read-only release manifest from the packaged artifacts.
// Runs on Windows CI after `package:win` + `package:verify`; hashes the
// installer/sidecars/icons/SBOM, reads versions/commit/licenses, and writes
// release/manifest.json + release/hashes.json + a versioned markdown copy of
// the install-package checklist. The design template
// docs/11-implementation/Echocue-Windows安装包清单与兼容矩阵-v0.1.md is never
// rewritten; this only produces a new release artifact.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

export interface ReleaseManifestInputs {
  appVersion: string;
  gitCommit: string;
  electronVersion: string;
  sidecarVersions: { qdrant: string; douyinLive: string };
  artifactShas: Record<string, string>;
  licenseCount: number;
  sbomRef: string;
  signature: string;
}

export interface ReleaseManifestOutput {
  manifest: Record<string, unknown>;
  markdown: string;
}

export function buildReleaseManifest(inputs: ReleaseManifestInputs): ReleaseManifestOutput {
  const shortCommit = inputs.gitCommit.slice(0, 7);
  const manifest: Record<string, unknown> = {
    app: {
      name: 'Echocue',
      version: inputs.appVersion,
      commit: inputs.gitCommit,
      commitShort: shortCommit,
    },
    electronRuntime: inputs.electronVersion,
    sidecars: {
      qdrant: { version: inputs.sidecarVersions.qdrant },
      douyinLive: { version: inputs.sidecarVersions.douyinLive },
    },
    artifacts: inputs.artifactShas,
    license: { scannedPackages: inputs.licenseCount },
    sbomRef: inputs.sbomRef,
    signature: inputs.signature,
  };
  const rows = Object.entries(inputs.artifactShas).map(
    ([name, sha]) => `| ${name} | ${sha} |`,
  );
  const markdown = [
    `# Echocue Windows 安装包清单 v${inputs.appVersion} (${shortCommit})`,
    '',
    '> 只读发布归档，由 scripts/generate-release-manifest.ts 生成；设计模板见 docs/11-implementation/Echocue-Windows安装包清单与兼容矩阵-v0.1.md。',
    '',
    `- 应用版本：${inputs.appVersion}`,
    `- Git commit：${inputs.gitCommit}`,
    `- Electron runtime：${inputs.electronVersion}`,
    `- Qdrant sidecar：${inputs.sidecarVersions.qdrant}`,
    `- douyinLive sidecar：${inputs.sidecarVersions.douyinLive}`,
    `- 许可证扫描：${inputs.licenseCount} 个包（dist/compliance/licenses.json）`,
    `- SBOM：${inputs.sbomRef}`,
    `- 签名：${inputs.signature}`,
    '',
    '## Artifact SHA-256',
    '',
    '| Artifact | SHA-256 |',
    '| --- | --- |',
    ...rows,
    '',
  ].join('\n');
  return { manifest, markdown };
}

function sha256Hex(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function gitHead(): string {
  return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
}

function probeVersion(binaryPath: string): string | null {
  try {
    const out = execSync(`"${binaryPath}" --version`, {
      encoding: 'utf8',
      timeout: 10_000,
    }).trim();
    return out.length > 0 ? out.slice(0, 160) : null;
  } catch {
    return null;
  }
}

function main(): void {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  const electronPkg = JSON.parse(
    readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
  ) as { version: string };
  const releaseDir = join(root, 'release');
  const complianceDir = join(root, 'dist', 'compliance');

  const installer = readdirSync(releaseDir)
    .filter((f) => f.endsWith('.exe'))
    .find((f) => f.includes('Setup'));
  if (!installer) throw new Error('no NSIS installer under release/');

  const artifactShas: Record<string, string> = {};
  artifactShas[`installer/${installer}`] = sha256Hex(join(releaseDir, installer));
  for (const rel of [
    'assets/qdrant_windows.exe',
    'assets/douyinLive_windows.exe',
    'build/icon.png',
    'build/tray.png',
  ]) {
    artifactShas[rel] = sha256Hex(join(root, rel));
  }

  const licensesPath = join(complianceDir, 'licenses.json');
  const sbomPath = join(complianceDir, 'sbom.cdx.json');
  if (!existsSync(licensesPath) || !existsSync(sbomPath)) {
    throw new Error('dist/compliance/licenses.json and sbom.cdx.json are required');
  }
  const licenses = JSON.parse(readFileSync(licensesPath, 'utf8')) as Record<string, unknown>;
  const sbomRef = `dist/compliance/sbom.cdx.json (sha256:${sha256Hex(sbomPath)})`;

  // Probe the Windows binaries for real versions; fall back to assets/README
  // pins when the exe cannot run (e.g. a local non-Windows run).
  const readme = readFileSync(join(root, 'assets', 'README.md'), 'utf8');
  const qdrantFallback = readme.match(/Qdrant v([\d.]+)/)?.[0] ?? 'unknown';
  const douyinFallback = readme.match(/DouyinLive Danmaku Server v([\d.]+)/)?.[0] ?? 'unknown';
  const qdrant = probeVersion(join(root, 'assets', 'qdrant_windows.exe')) ?? qdrantFallback;
  const douyin = probeVersion(join(root, 'assets', 'douyinLive_windows.exe')) ?? douyinFallback;

  const inputs: ReleaseManifestInputs = {
    appVersion: pkg.version,
    gitCommit: gitHead(),
    electronVersion: electronPkg.version,
    sidecarVersions: { qdrant, douyinLive: douyin },
    artifactShas,
    licenseCount: Object.keys(licenses).length,
    sbomRef,
    signature: 'unsigned (no code-signing cert; 需发布环境证书补签)',
  };

  const { manifest, markdown } = buildReleaseManifest(inputs);
  const short = inputs.gitCommit.slice(0, 7);
  writeFileSync(join(releaseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(releaseDir, 'hashes.json'), `${JSON.stringify(artifactShas, null, 2)}\n`);
  writeFileSync(
    join(releaseDir, `Echocue-Windows安装包清单-v${inputs.appVersion}-${short}.md`),
    markdown,
  );
  console.log('wrote release/manifest.json, release/hashes.json and the versioned checklist');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
