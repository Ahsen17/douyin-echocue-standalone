import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// M7-08 / T-PKG-001 / WP-5: the installer is per-user assisted (WP-5 adds a
// changeable install directory + custom data-dir page) and must bundle every
// runtime resource so first launch never downloads binaries. The real
// install/launch verification runs on Windows CI (package-windows.yml); here we
// pin the config against the repository's actual files.
const CONFIG = 'electron-builder.yml';

describe('electron-builder packaging config (M7-08 / T-PKG-001)', () => {
  const text = readFileSync(join(process.cwd(), CONFIG), 'utf8');

  it('installs per-user one-click with a data-location pointer include', () => {
    expect(text).toMatch(/oneClick:\s*true/);
    expect(text).toMatch(/perMachine:\s*false/);
    expect(text).toMatch(/deleteAppDataOnUninstall:\s*false/);
    // WP-5: the include writes the data-location boot pointer (assisted installer
    // was reverted — the assisted page flow crashed with 0xC0000005 on Windows).
    expect(text).toMatch(/include:\s*build\/installer\.nsh/);
    expect(text).not.toMatch(/allowToChangeInstallationDirectory:\s*true/);
  });

  it('carries the WP-5 data pointer and the WP-6 optional-cleanup uninstaller', () => {
    const installer = readFileSync(join(process.cwd(), 'build', 'installer.nsh'), 'utf8');
    expect(installer).toMatch(/customInstall/);
    // Single include file carries both the installer and the uninstaller macro.
    expect(installer).toMatch(/customUnInstall/);
    expect(installer).toMatch(/cleanData/);
    expect(installer).toMatch(/RMDir \/r/);
    expect(installer).toMatch(/MB_DEFBUTTON2/);
    expect(installer).toMatch(/data-location\.txt/);
    // No interactive custom page (removed after Windows-installer crash); the
    // data root is the default + in-app migration. No fragile WordReplace/JSON.
    expect(installer).not.toMatch(/customPageAfterChangeDir/);
    expect(installer).not.toMatch(/WordReplace/);
    // No separate include that makensis cannot resolve.
    expect(installer).not.toMatch(/include "uninstaller\.nsh"/);
  });

  it('bundles every required runtime resource', () => {
    const required = [
      'assets/qdrant_windows.exe',
      'assets/douyinLive_windows.exe',
      'resources/qdrant-config.yaml',
      'docs/06-data-interface/migrations/001_initial_schema.sql',
      'build/icon.png',
      'build/tray.png',
    ];
    for (const rel of required) {
      expect(text, `electron-builder.yml must bundle ${rel}`).toContain(`from: ${rel}`);
      expect(existsSync(join(process.cwd(), rel)), `source must exist: ${rel}`).toBe(true);
    }
  });

  it('ships the externalized runtime node_modules', () => {
    expect(text).toContain('node_modules/jieba-wasm/**');
    expect(text).toContain('node_modules/@qdrant/**');
    expect(text).toContain('node_modules/undici/**');
  });
});
