import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');

describe('T-PKG-001: package compliance', () => {
  it('package-lock.json exists and is valid JSON', () => {
    const lockPath = resolve(root, 'package-lock.json');
    expect(existsSync(lockPath)).toBe(true);
    expect(() => JSON.parse(readFileSync(lockPath, 'utf8'))).not.toThrow();
  });

  it('no ^ or ~ version prefixes in package.json deps', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(allDeps)) {
      if (name === '@echocue/contracts') continue;
      expect(
        (version as string).startsWith('^') || (version as string).startsWith('~'),
        `${name}: "${version}" must be pinned (no ^ or ~)`
      ).toBe(false);
    }
  });

  it('scripts/license-check.js exists', () => {
    expect(existsSync(resolve(root, 'scripts/license-check.js'))).toBe(true);
  });

  it('license-check.js contains all required prohibited licenses', () => {
    const content = readFileSync(resolve(root, 'scripts/license-check.js'), 'utf8');
    const required = ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'LGPL-2.0', 'LGPL-2.1', 'LGPL-3.0'];
    for (const lic of required) {
      expect(content, `missing prohibited license: ${lic}`).toContain(lic);
    }
  });
});
