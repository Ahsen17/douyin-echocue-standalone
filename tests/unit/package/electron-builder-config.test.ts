import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// M7-08 / T-PKG-001: the installer must be one-click per-user and must bundle
// every runtime resource so first launch never downloads binaries. The real
// install/launch verification runs on Windows CI (package-windows.yml); here we
// pin the config against the repository's actual files.
const CONFIG = 'electron-builder.yml';

describe('electron-builder packaging config (M7-08 / T-PKG-001)', () => {
  const text = readFileSync(join(process.cwd(), CONFIG), 'utf8');

  it('installs per-user one-click without path selection', () => {
    expect(text).toMatch(/oneClick:\s*true/);
    expect(text).toMatch(/perMachine:\s*false/);
    expect(text).toMatch(/deleteAppDataOnUninstall:\s*false/);
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
