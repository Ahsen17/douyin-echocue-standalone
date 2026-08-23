import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// T-PKG-001 (Windows E2E): these cases only run in the packaging job
// (.github/workflows/package-windows.yml), which sets ECHOCUE_PKG_DIR to the
// release/ directory containing the built installer and verify-results.json
// produced by scripts/win-install-verify.ps1. Without that artifact the cases
// are skipped — a real packaged install cannot be exercised in the fast job.
const pkgDir = process.env.ECHOCUE_PKG_DIR;
const skip = !pkgDir;

const PE_MACHINE_X64 = 0x8664;

function findInstaller(): string {
  const files = readdirSync(pkgDir!).filter((f) => f.endsWith('.exe'));
  const exe = files.find((f) => f.includes('Setup'));
  expect(exe, `no NSIS installer under ${pkgDir}`).toBeTruthy();
  return join(pkgDir!, exe!);
}

function readVerifyResults(): Record<string, unknown> {
  const raw = readFileSync(join(pkgDir!, 'verify-results.json'), 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, '')) as Record<string, unknown>;
}

// Minimal PE inspection: MZ signature, then the COFF Machine field which is
// 0x8664 for x64 and 0x014c for x86.
function peMachine(buf: Buffer): number | null {
  if (buf.length < 64 || buf.toString('latin1', 0, 2) !== 'MZ') return null;
  const peOff = buf.readUInt32LE(0x3c);
  // 'PE' + two NUL bytes = hex 50450000; compare in hex so the source file
  // carries no literal NUL bytes (which would make git treat it as binary).
  if (buf.subarray(peOff, peOff + 4).toString('hex') !== '50450000') return null;
  return buf.readUInt16LE(peOff + 4);
}

function sha256Hex(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// assets/README.md pins the sidecar SHAs; the installed resources/ must match.
function expectedSidecarShas(): Record<string, string> {
  const readme = readFileSync(join(process.cwd(), 'assets', 'README.md'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of readme.split('\n')) {
    const m = /^-\s+`([^`]+)`（Windows x64）SHA-256: `([0-9a-f]{64})`/.exec(line);
    if (m) out[join('assets', m[1])] = m[2];
  }
  return out;
}

describe.skipIf(skip)('T-PKG-001: Windows Package and Install', () => {
  it('should build a Windows x64 installer', () => {
    expect(existsSync(findInstaller())).toBe(true);
    // NSIS Setup.exe stubs are always x86 PE regardless of the x64 target; the
    // real x64 payload is the unpacked app binary that the installer ships.
    const appExe = join(pkgDir!, 'win-unpacked', 'Echocue.exe');
    expect(existsSync(appExe), `missing unpacked app ${appExe}`).toBe(true);
    const header = readFileSync(appExe).subarray(0, 4096);
    expect(peMachine(header)).toBe(PE_MACHINE_X64);
  });

  it('should install without Docker or runtime downloads', () => {
    const r = readVerifyResults();
    expect(r.passed).toBe(true);
    expect(r.launchExitCode).toBe(0);
    expect(r.bundledResources).toEqual(
      expect.arrayContaining([
        'assets\\qdrant_windows.exe',
        'assets\\douyinLive_windows.exe',
        'docs\\06-data-interface\\migrations\\001_initial_schema.sql',
        'build\\tray.png',
      ]),
    );
  });

  it('should bundle Qdrant and douyinLive binaries with pinned SHAs', () => {
    // The installer's win-unpacked bundle carries exactly the resources that get
    // installed (the verify script asserts the installed copy exists during the
    // install phase, before it uninstalls the app).
    const resources = join(pkgDir!, 'win-unpacked', 'resources');
    const expected = expectedSidecarShas();
    expect(Object.keys(expected).length).toBeGreaterThanOrEqual(2);
    for (const [rel, sha] of Object.entries(expected)) {
      const file = join(resources, rel);
      expect(existsSync(file), `missing bundled resource ${file}`).toBe(true);
      expect(sha256Hex(file), `sha mismatch for ${rel}`).toBe(sha);
    }
  });

  it('should clean up sidecar processes on exit', () => {
    const r = readVerifyResults();
    expect(r.noOrphanProcesses).toBe(true);
  });

  it('should upgrade without data loss', () => {
    const r = readVerifyResults();
    expect(r.upgradeLaunchExitCode).toBe(0);
    expect(r.upgradeDataPreserved).toBe(true);
    expect(r.uninstallDataPreserved).toBe(true);
  });
});
