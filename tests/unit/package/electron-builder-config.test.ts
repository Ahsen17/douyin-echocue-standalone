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

  it('installs per-user assisted with a changeable directory and data-dir page', () => {
    expect(text).toMatch(/oneClick:\s*false/);
    expect(text).toMatch(/allowToChangeInstallationDirectory:\s*true/);
    expect(text).toMatch(/perMachine:\s*false/);
    expect(text).toMatch(/deleteAppDataOnUninstall:\s*false/);
    expect(text).toMatch(/include:\s*build\/installer\.nsh/);
  });

  it('carries the WP-5 data-dir page and the WP-6 optional-cleanup uninstaller', () => {
    const installer = readFileSync(join(process.cwd(), 'build', 'installer.nsh'), 'utf8');
    expect(installer).toMatch(/customInstall/);
    expect(installer).toMatch(/data-location\.json/);
    // The data-dir page must actually be registered in the assisted page flow.
    expect(installer).toMatch(/customPageAfterChangeDir/);
    expect(installer).toMatch(/Page custom EchocueDataPageCreate EchocueDataPageLeave/);
    expect(installer).toMatch(/data-location\.txt/);
    expect(installer).toMatch(/include "uninstaller\.nsh"/);

    const uninstaller = readFileSync(join(process.cwd(), 'build', 'uninstaller.nsh'), 'utf8');
    expect(uninstaller).toMatch(/customUnInstall/);
    expect(uninstaller).toMatch(/cleanData/);
    expect(uninstaller).toMatch(/data-location\.txt/);
    expect(uninstaller).toMatch(/RMDir \/r/);
    expect(uninstaller).toMatch(/MB_DEFBUTTON2/);
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
