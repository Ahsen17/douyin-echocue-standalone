import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

import { resolveResourcePath } from '../../../src/main/util/resource-path.js';

beforeAll(() => {
  Object.defineProperty(process, 'resourcesPath', {
    value: '/mock/resources',
    configurable: true,
  });
});

describe('resolveResourcePath (M7-08 packaged resource resolution)', () => {
  it('resolves dev resources from the repo root', () => {
    expect(resolveResourcePath('assets/qdrant_windows.exe', false)).toBe(
      join(process.cwd(), 'assets/qdrant_windows.exe'),
    );
  });

  it('resolves packaged resources under process.resourcesPath', () => {
    expect(resolveResourcePath('assets/qdrant_windows.exe', true)).toBe(
      join('/mock/resources', 'assets/qdrant_windows.exe'),
    );
  });

  it('defaults to the dev path in a unit-test environment (app not packaged)', () => {
    expect(resolveResourcePath('build/tray.png')).toBe(join(process.cwd(), 'build/tray.png'));
  });
});
